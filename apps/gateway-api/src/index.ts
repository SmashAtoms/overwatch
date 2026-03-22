import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Type } from "@sinclair/typebox";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { DEFAULT_REGION } from "@signalstack/contracts";
import { createMockLiveEvent, filterEventsByQuery, sanitizeLayerStatuses } from "@signalstack/policy";
import { adapterHealth, events, replay, stacks } from "./data.js";
import { loadCameraSources } from "./cameras.js";
import {
  getAircraftLayerHealth,
  getAircraftLiveBbox,
  getLiveAircraftSnapshot,
  mergeLiveAircraftIntoEvents
} from "./aircraft.js";
import {
  buildFlightByNumberWebhookUrl,
  getAeroDataBoxConfig,
  listFlightSubscriptions,
  listWebhookEvents,
  recordFlightSubscription,
  recordWebhookEvent,
  subscribeToFlightByNumber
} from "./aerodatabox.js";
import { OpenAIRealtimeProvider } from "./services/transcription/openai-realtime-provider.js";
import { DispatchPipeline } from "./services/pipeline/dispatch-pipeline.js";

loadEnv({
  path: resolve(process.cwd(), "../../.env.local")
});

const app = Fastify({
  logger: true
});

type StreamSocket = {
  send: (payload: string) => void;
};

const streamClients = new Set<StreamSocket>();

function broadcastEvent(type: string, payload: unknown) {
  const message = JSON.stringify({ type, payload });
  streamClients.forEach((socket) => {
    try {
      socket.send(message);
    } catch {
      // Ignore dead sockets; close handler removes them.
    }
  });
}

function parseDispatchStreamUrls(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) {
    return [];
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
      }
    } catch {
      // fall through to CSV parsing
    }
  }

  return trimmed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const dispatchStreamUrls = parseDispatchStreamUrls(process.env.DISPATCH_STREAM_URLS);
const dispatchPipelineEnabled = (process.env.DISPATCH_PIPELINE_ENABLED ?? "true").toLowerCase() === "true";
const dispatchPipelineAutostart = (process.env.DISPATCH_PIPELINE_AUTOSTART ?? "false").toLowerCase() === "true";
const dispatchChunkIntervalMs = Number(process.env.DISPATCH_CHUNK_INTERVAL_MS ?? 1000);
const dispatchFinalizeEveryChunks = Number(process.env.DISPATCH_FINALIZE_EVERY_CHUNKS ?? 4);
const parserRuleConfidenceMin = Number(process.env.PARSER_RULE_CONFIDENCE_MIN ?? 0.65);
const dispatchTranscriptionProvider = new OpenAIRealtimeProvider({
  apiKey: process.env.OPENAI_API_KEY ?? null,
  model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-realtime-preview"
});

const dispatchPipeline = new DispatchPipeline({
  streamUrls: dispatchStreamUrls,
  chunkIntervalMs: Number.isFinite(dispatchChunkIntervalMs) ? dispatchChunkIntervalMs : 1000,
  finalizeEveryChunks: Number.isFinite(dispatchFinalizeEveryChunks) ? dispatchFinalizeEveryChunks : 4,
  provider: dispatchTranscriptionProvider,
  parserFallback: {
    apiKey: process.env.OPENAI_API_KEY ?? null,
    model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-realtime-preview",
    confidenceThreshold: Number.isFinite(parserRuleConfidenceMin) ? parserRuleConfidenceMin : 0.65
  },
  onEvent: ({ type, payload }) => {
    broadcastEvent(type, payload);
  }
});

if (dispatchPipelineEnabled && dispatchPipelineAutostart && dispatchStreamUrls.length > 0) {
  dispatchPipeline.startAll();
}

const SKYLINE_SOURCE_PATTERN = /source:'([^']*m3u8\?a=[^']+)'/i;
const HDONTAP_PLAYER_DATA_PATTERN = /<script id="player-data" type="application\/json">([\s\S]*?)<\/script>/i;
const SKYLINE_NETWORK_M3U8_PATTERN = /https:\/\/hd-auth\.skylinewebcams\.com\/live\.m3u8\?a=[^"'&\s]+/i;
const SKYLINE_FALLBACK_TOKENS: Record<string, string> = {
  "virginia-city/virginia-city.html": "92b5pqmocg4gevq3oligb9ca23"
};
const SKYLINE_STREAM_CACHE_TTL_MS = 120_000;
const SKYLINE_BROWSER_TIMEOUT_MS = 20_000;
const EARTHCAM_API_PATTERN = /window\.earthcam\.api\s*=\s*"([^"]+)"/i;
const EARTHCAM_CLIENT_PATTERN = /window\.earthcam\.client\s*=\s*'([^']+)'/i;
const EARTHCAM_ALLOWED_HOSTS = ["earthcam.net", "earthcam.com"];
const DIRECT_HLS_ALLOWED_HOSTS = ["166.203.170.148"];
const SKYLINE_EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];

const skylineStreamCache = new Map<
  string,
  {
    streamUrl: string;
    resolvedAt: number;
  }
>();

const skylineManualStreamCache = new Map<
  string,
  {
    streamUrl: string;
    resolvedAt: number;
  }
>();

function getEdgeExecutablePath(): string | null {
  const candidate = SKYLINE_EDGE_PATHS.find((path) => existsSync(path));
  return candidate ?? null;
}

function isLivePlaylistContent(playlist: string): boolean {
  return /#EXTINF|\.ts|\.m4s/i.test(playlist);
}

async function validateSkylineStreamUrl(streamUrl: string): Promise<boolean> {
  try {
    const response = await fetch(streamUrl, {
      headers: {
        "user-agent": "SmashAtoms-Overwatch/1.0",
        origin: "https://www.skylinewebcams.com",
        referer: "https://www.skylinewebcams.com/"
      }
    });

    if (!response.ok) {
      return false;
    }

    const raw = Buffer.from(await response.arrayBuffer());
    const playlist = raw.toString("utf8");
    return isLivePlaylistContent(playlist);
  } catch {
    return false;
  }
}

async function resolveSkylineStreamSourceViaBrowser(pageUrl: string): Promise<string | null> {
  const edgeExecutablePath = getEdgeExecutablePath();
  if (!edgeExecutablePath) {
    return null;
  }

  const playwright = await import("playwright-core");
  const browser = await playwright.chromium.launch({
    executablePath: edgeExecutablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"]
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 768 },
      locale: "en-US"
    });

    const page = await context.newPage();
    let capturedStreamUrl: string | null = null;

    page.on("request", (request) => {
      const url = request.url();
      if (SKYLINE_NETWORK_M3U8_PATTERN.test(url)) {
        capturedStreamUrl = url;
      }
    });

    page.on("response", (response) => {
      const url = response.url();
      if (SKYLINE_NETWORK_M3U8_PATTERN.test(url)) {
        capturedStreamUrl = url;
      }
    });

    await page.goto(pageUrl, {
      waitUntil: "networkidle",
      timeout: SKYLINE_BROWSER_TIMEOUT_MS
    });

    if (!capturedStreamUrl) {
      await page.waitForTimeout(4_000);
    }

    return capturedStreamUrl;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

async function resolveSkylineStreamSource(pageUrl: string, cameraId?: string): Promise<string | null> {
  if (cameraId) {
    const manual = skylineManualStreamCache.get(cameraId);
    if (manual && Date.now() - manual.resolvedAt < SKYLINE_STREAM_CACHE_TTL_MS) {
      const manualIsLive = await validateSkylineStreamUrl(manual.streamUrl);
      if (manualIsLive) {
        return manual.streamUrl;
      }
    }
  }

  const cached = skylineStreamCache.get(pageUrl);
  if (cached && Date.now() - cached.resolvedAt < SKYLINE_STREAM_CACHE_TTL_MS) {
    const cachedIsLive = await validateSkylineStreamUrl(cached.streamUrl);
    if (cachedIsLive) {
      return cached.streamUrl;
    }
  }

  const response = await fetch(pageUrl, {
    headers: {
      "user-agent": "SmashAtoms-Overwatch/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Skyline page request failed: ${response.status}`);
  }

  const html = await response.text();
  const match = html.match(SKYLINE_SOURCE_PATTERN);
  const matchedSource = match?.[1] ?? null;
  let token = matchedSource ? new URL(matchedSource, pageUrl).searchParams.get("a") : null;
  let streamUrl = token
    ? `https://hd-auth.skylinewebcams.com/live.m3u8?a=${encodeURIComponent(token)}`
    : null;

  if (streamUrl) {
    const streamIsLive = await validateSkylineStreamUrl(streamUrl);
    if (streamIsLive) {
      skylineStreamCache.set(pageUrl, {
        streamUrl,
        resolvedAt: Date.now()
      });
      return streamUrl;
    }
  }

  const browserResolved = await resolveSkylineStreamSourceViaBrowser(pageUrl);
  if (browserResolved) {
    const browserResolvedIsLive = await validateSkylineStreamUrl(browserResolved);
    if (browserResolvedIsLive) {
      skylineStreamCache.set(pageUrl, {
        streamUrl: browserResolved,
        resolvedAt: Date.now()
      });
      return browserResolved;
    }
  }

  if (!token) {
    const fallbackEntry = Object.entries(SKYLINE_FALLBACK_TOKENS).find(([pageFragment]) =>
    pageUrl.includes(pageFragment)
  );
    token = fallbackEntry?.[1] ?? null;
  }

  if (!token) {
    return null;
  }

  streamUrl = `https://hd-auth.skylinewebcams.com/live.m3u8?a=${encodeURIComponent(token)}`;
  const fallbackIsLive = await validateSkylineStreamUrl(streamUrl);
  if (!fallbackIsLive) {
    return null;
  }

  skylineStreamCache.set(pageUrl, {
    streamUrl,
    resolvedAt: Date.now()
  });
  return streamUrl;
}

async function resolveHdontapStreamSource(pageUrl: string): Promise<string | null> {
  const response = await fetch(pageUrl, {
    headers: {
      "user-agent": "SmashAtoms-Overwatch/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`HDOnTap page request failed: ${response.status}`);
  }

  const html = await response.text();
  const match = html.match(HDONTAP_PLAYER_DATA_PATTERN);
  const playerDataJson = match?.[1] ?? null;

  if (!playerDataJson) {
    return null;
  }

  try {
    const playerData = JSON.parse(playerDataJson) as { streamSrc?: unknown };
    return typeof playerData.streamSrc === "string" ? playerData.streamSrc : null;
  } catch {
    return null;
  }
}

function isAllowedEarthCamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }

    return EARTHCAM_ALLOWED_HOSTS.some(
      (hostSuffix) => parsed.hostname === hostSuffix || parsed.hostname.endsWith(`.${hostSuffix}`)
    );
  } catch {
    return false;
  }
}

function rewritePlaylistForProxy(playlist: string, baseUrl: string, proxyPrefix: string): string {
  const base = new URL(baseUrl);

  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }

      if (trimmed.startsWith("#")) {
        if (!trimmed.includes('URI="')) {
          return line;
        }
        return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
          const resolved = new URL(uri, base).toString();
          return `URI="${proxyPrefix}?url=${encodeURIComponent(resolved)}"`;
        });
      }

      const resolved = new URL(trimmed, base).toString();
      return `${proxyPrefix}?url=${encodeURIComponent(resolved)}`;
    })
    .join("\n");
}

function isAllowedDirectHlsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    return DIRECT_HLS_ALLOWED_HOSTS.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

async function fetchEarthCamApiUrl(pageUrl: string): Promise<string | null> {
  const response = await fetch(pageUrl, {
    headers: {
      "user-agent": "SmashAtoms-Overwatch/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`EarthCam page request failed: ${response.status}`);
  }

  const html = await response.text();
  const directApiMatch = html.match(EARTHCAM_API_PATTERN);
  if (directApiMatch?.[1]) {
    return directApiMatch[1];
  }

  const clientMatch = html.match(EARTHCAM_CLIENT_PATTERN);
  if (!clientMatch?.[1]) {
    return null;
  }

  return `https://share.earthcam.net/api/${clientMatch[1]}`;
}

async function resolveEarthCamStreamSource(pageUrl: string): Promise<string | null> {
  const apiUrl = await fetchEarthCamApiUrl(pageUrl);
  if (!apiUrl) {
    return null;
  }

  const response = await fetch(apiUrl, {
    headers: {
      "user-agent": "SmashAtoms-Overwatch/1.0",
      origin: "https://share.earthcam.net",
      referer: "https://share.earthcam.net/"
    }
  });

  if (!response.ok) {
    throw new Error(`EarthCam API request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    projects?: Array<{
      servers?: Array<{
        api?: string;
        views?: Array<{
          live?: {
            regular?: {
              stream?: string;
            };
          };
        }>;
      }>;
    }>;
  };

  let stream = payload.projects?.[0]?.servers?.[0]?.views?.[0]?.live?.regular?.stream;
  if (typeof stream === "string") {
    return stream;
  }

  const serverApiPath = payload.projects?.[0]?.servers?.[0]?.api;
  if (typeof serverApiPath !== "string") {
    return null;
  }

  const serverApiUrl = new URL(serverApiPath, "https://share.earthcam.net").toString();
  const serverResponse = await fetch(serverApiUrl, {
    headers: {
      "user-agent": "SmashAtoms-Overwatch/1.0",
      origin: "https://share.earthcam.net",
      referer: "https://share.earthcam.net/"
    }
  });

  if (!serverResponse.ok) {
    throw new Error(`EarthCam server API request failed: ${serverResponse.status}`);
  }

  const serverPayload = (await serverResponse.json()) as {
    views?: Array<{
      live?: {
        regular?: {
          stream?: string;
        };
      };
    }>;
  };

  stream = serverPayload.views?.[0]?.live?.regular?.stream;
  if (typeof stream !== "string") {
    return null;
  }

  return stream;
}

await app.register(cors, {
  origin: true
});

await app.register(websocket);

app.get("/health", async () => ({
  status: "ok",
  service: "gateway-api",
  now: new Date().toISOString()
}));

app.get("/api/v1/region", async () => DEFAULT_REGION);
app.get("/api/v1/layers/status", async () => {
  const liveAircraftHealth = await getAircraftLayerHealth();
  const otherLayers = adapterHealth.filter((layer) => layer.kind !== "aircraft");
  return sanitizeLayerStatuses([liveAircraftHealth, ...otherLayers]);
});

app.get(
  "/api/v1/events",
  {
    schema: {
      querystring: Type.Object({
        sourceType: Type.Optional(Type.String()),
        minConfidence: Type.Optional(Type.Number()),
        refreshAircraft: Type.Optional(Type.Boolean())
      })
    }
  },
  async (request) => {
    const { sourceType, minConfidence, refreshAircraft } = request.query as {
      sourceType?: string;
      minConfidence?: number;
      refreshAircraft?: boolean;
    };
    let aircraftEvents: typeof events = [];
    try {
      const aircraftSnapshot = await getLiveAircraftSnapshot({
        forceRefresh: refreshAircraft === true
      });
      aircraftEvents = aircraftSnapshot.events;
    } catch {
      // Keep the rest of the dashboard loading without injecting stale mock aircraft.
    }

    const mergedEvents = mergeLiveAircraftIntoEvents(events, aircraftEvents);
    return filterEventsByQuery(mergedEvents, { sourceType, minConfidence });
  }
);

app.get("/api/v1/aircraft/live", async (request, reply) => {
  const query = request.query as { refresh?: string | boolean | undefined };
  const refresh = query.refresh === "true" || query.refresh === true;
  let snapshot;

  try {
    snapshot = await getLiveAircraftSnapshot({
      forceRefresh: refresh
    });
  } catch (error) {
    request.log.warn({ error }, "live aircraft fetch failed");
    return {
      ok: false,
      error: "Live aircraft data is temporarily unavailable."
    };
  }

  return {
    ok: true,
    fetchedAt: snapshot.fetchedAt,
    bbox: getAircraftLiveBbox(),
    count: snapshot.events.length,
    items: snapshot.events
  };
});

app.get("/api/v1/stacks", async () => stacks);
app.get("/api/v1/cameras", async (request) => {
  const cameras = await loadCameraSources();
  const requestHost = request.headers.host ?? "127.0.0.1:4000";
  const requestProtocol = request.protocol ?? "http";

  return cameras.map((camera) => {
    const isSkylineEmbedPlayer =
      camera.provider === "SkylineWebcams" &&
      typeof camera.previewUrl === "string" &&
      camera.previewUrl.includes("embed.skylinewebcams.com/player/");

    if (isSkylineEmbedPlayer) {
      return camera;
    }

    const isBrownriceSnapshot =
      camera.provider === "Brownrice" &&
      typeof camera.previewUrl === "string" &&
      /player\.brownrice\.com\/snapshot\//i.test(camera.previewUrl);

    if (
      camera.provider !== "SkylineWebcams" &&
      camera.provider !== "HDOnTap" &&
      camera.provider !== "EarthCam" &&
      camera.provider !== "Direct HLS" &&
      !isBrownriceSnapshot
    ) {
      return camera;
    }

    return {
      ...camera,
      previewUrl: isBrownriceSnapshot
        ? `${requestProtocol}://${requestHost}/api/v1/cameras/${camera.id}/media`
        : camera.provider === "Direct HLS"
          ? `${requestProtocol}://${requestHost}/api/v1/cameras/${camera.id}/direct-stream.m3u8`
          : `${requestProtocol}://${requestHost}/api/v1/cameras/${camera.id}/stream.m3u8`
    };
  });
});
app.get("/api/v1/cameras/:cameraId/stream.m3u8", async (request, reply) => {
  const { cameraId } = request.params as { cameraId: string };
  const cameras = await loadCameraSources();
  const camera = cameras.find((entry) => entry.id === cameraId);

  if (
    !camera?.targetUrl ||
    (camera.provider !== "SkylineWebcams" &&
      camera.provider !== "HDOnTap" &&
      camera.provider !== "EarthCam")
  ) {
    reply.code(404);
    return { error: "Camera stream not found." };
  }

  try {
    const streamUrl =
      camera.provider === "SkylineWebcams"
        ? await resolveSkylineStreamSource(camera.targetUrl, cameraId)
        : camera.provider === "HDOnTap"
          ? await resolveHdontapStreamSource(camera.targetUrl)
          : await resolveEarthCamStreamSource(camera.targetUrl);

    if (!streamUrl) {
      reply.code(404);
      return { error: "Live stream source unavailable." };
    }

    if (camera.provider !== "EarthCam") {
      return reply.redirect(streamUrl);
    }

    const upstreamResponse = await fetch(streamUrl, {
      headers: {
        "user-agent": "SmashAtoms-Overwatch/1.0",
        origin: "https://share.earthcam.net",
        referer: "https://share.earthcam.net/"
      }
    });

    if (!upstreamResponse.ok) {
      reply.code(upstreamResponse.status);
      return { error: "EarthCam stream source unavailable." };
    }

    const playlistText = await upstreamResponse.text();
    const requestHost = request.headers.host ?? "127.0.0.1:4000";
    const requestProtocol = request.protocol ?? "http";
    const proxyPrefix = `${requestProtocol}://${requestHost}/api/v1/cameras/${cameraId}/earthcam-proxy`;
    const rewritten = rewritePlaylistForProxy(playlistText, streamUrl, proxyPrefix);

    reply.header("content-type", "application/vnd.apple.mpegurl");
    reply.header("cache-control", "no-store, max-age=0");
    return reply.send(rewritten);
  } catch (error) {
    request.log.warn({ error, cameraId }, "failed to resolve camera stream");
    reply.code(502);
    return { error: "Unable to resolve live stream." };
  }
});
app.get(
  "/api/v1/cameras/:cameraId/direct-stream.m3u8",
  {
    schema: {
      params: Type.Object({
        cameraId: Type.String({ minLength: 1 })
      })
    }
  },
  async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    const cameras = await loadCameraSources();
    const camera = cameras.find((entry) => entry.id === cameraId);
    const sourceUrl = camera?.previewUrl ?? camera?.targetUrl ?? null;

    if (!camera || camera.provider !== "Direct HLS" || !sourceUrl || !isAllowedDirectHlsUrl(sourceUrl)) {
      reply.code(404);
      return { error: "Direct HLS camera stream not found." };
    }

    const upstreamResponse = await fetch(sourceUrl, {
      headers: {
        "user-agent": "SmashAtoms-Overwatch/1.0"
      }
    });

    if (!upstreamResponse.ok) {
      reply.code(upstreamResponse.status);
      return { error: "Direct HLS stream unavailable." };
    }

    const playlistText = await upstreamResponse.text();
    const requestHost = request.headers.host ?? "127.0.0.1:4000";
    const requestProtocol = request.protocol ?? "http";
    const proxyPrefix = `${requestProtocol}://${requestHost}/api/v1/cameras/${cameraId}/direct-proxy`;
    const rewritten = rewritePlaylistForProxy(playlistText, sourceUrl, proxyPrefix);

    reply.header("content-type", "application/vnd.apple.mpegurl");
    reply.header("cache-control", "no-store, max-age=0");
    return reply.send(rewritten);
  }
);
app.get(
  "/api/v1/cameras/:cameraId/direct-proxy",
  {
    schema: {
      params: Type.Object({
        cameraId: Type.String({ minLength: 1 })
      }),
      querystring: Type.Object({
        url: Type.String({ minLength: 1 })
      })
    }
  },
  async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    const { url } = request.query as { url: string };
    const cameras = await loadCameraSources();
    const camera = cameras.find((entry) => entry.id === cameraId);

    if (!camera || camera.provider !== "Direct HLS") {
      reply.code(404);
      return { error: "Direct HLS camera not found." };
    }

    if (!isAllowedDirectHlsUrl(url)) {
      reply.code(400);
      return { error: "Direct HLS proxy only allows approved hosts." };
    }

    const upstreamResponse = await fetch(url, {
      headers: {
        "user-agent": "SmashAtoms-Overwatch/1.0"
      }
    });

    if (!upstreamResponse.ok) {
      reply.code(upstreamResponse.status);
      return { error: "Direct HLS upstream unavailable." };
    }

    const contentType = upstreamResponse.headers.get("content-type") ?? "";
    const requestHost = request.headers.host ?? "127.0.0.1:4000";
    const requestProtocol = request.protocol ?? "http";
    const proxyPrefix = `${requestProtocol}://${requestHost}/api/v1/cameras/${cameraId}/direct-proxy`;

    if (/mpegurl|application\/vnd\.apple\.mpegurl/i.test(contentType) || /\.m3u8(\?|$)/i.test(url)) {
      const playlistText = await upstreamResponse.text();
      const rewritten = rewritePlaylistForProxy(playlistText, url, proxyPrefix);
      reply.header("content-type", "application/vnd.apple.mpegurl");
      reply.header("cache-control", "no-store, max-age=0");
      return reply.send(rewritten);
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    reply.header("content-type", contentType || "application/octet-stream");
    reply.header("cache-control", "no-store, max-age=0");
    return reply.send(buffer);
  }
);
app.get(
  "/api/v1/cameras/:cameraId/earthcam-proxy",
  {
    schema: {
      params: Type.Object({
        cameraId: Type.String({ minLength: 1 })
      }),
      querystring: Type.Object({
        url: Type.String({ minLength: 1 })
      })
    }
  },
  async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    const { url } = request.query as { url: string };
    const cameras = await loadCameraSources();
    const camera = cameras.find((entry) => entry.id === cameraId);

    if (!camera || camera.provider !== "EarthCam") {
      reply.code(404);
      return { error: "EarthCam camera not found." };
    }

    if (!isAllowedEarthCamUrl(url)) {
      reply.code(400);
      return { error: "EarthCam proxy only allows earthcam hosts." };
    }

    const upstreamResponse = await fetch(url, {
      headers: {
        "user-agent": "SmashAtoms-Overwatch/1.0",
        origin: "https://share.earthcam.net",
        referer: "https://share.earthcam.net/"
      }
    });

    if (!upstreamResponse.ok) {
      reply.code(upstreamResponse.status);
      return { error: "EarthCam upstream unavailable." };
    }

    const contentType = upstreamResponse.headers.get("content-type") ?? "";
    const requestHost = request.headers.host ?? "127.0.0.1:4000";
    const requestProtocol = request.protocol ?? "http";
    const proxyPrefix = `${requestProtocol}://${requestHost}/api/v1/cameras/${cameraId}/earthcam-proxy`;

    if (/mpegurl|application\/vnd\.apple\.mpegurl/i.test(contentType) || /\.m3u8(\?|$)/i.test(url)) {
      const playlistText = await upstreamResponse.text();
      const rewritten = rewritePlaylistForProxy(playlistText, url, proxyPrefix);
      reply.header("content-type", "application/vnd.apple.mpegurl");
      reply.header("cache-control", "no-store, max-age=0");
      return reply.send(rewritten);
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    reply.header("content-type", contentType || "application/octet-stream");
    reply.header("cache-control", "no-store, max-age=0");
    return reply.send(buffer);
  }
);
app.post(
  "/api/v1/cameras/:cameraId/stream-token",
  {
    schema: {
      params: Type.Object({
        cameraId: Type.String({ minLength: 1 })
      }),
      body: Type.Object({
        streamUrl: Type.String({ minLength: 1 })
      })
    }
  },
  async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    const { streamUrl } = request.body as { streamUrl: string };
    const cameras = await loadCameraSources();
    const camera = cameras.find((entry) => entry.id === cameraId);

    if (!camera || camera.provider !== "SkylineWebcams") {
      reply.code(404);
      return { ok: false, error: "Skyline camera not found." };
    }

    if (!SKYLINE_NETWORK_M3U8_PATTERN.test(streamUrl)) {
      reply.code(400);
      return { ok: false, error: "Invalid Skyline stream URL format." };
    }

    const isValid = await validateSkylineStreamUrl(streamUrl);
    if (!isValid) {
      reply.code(400);
      return { ok: false, error: "Provided Skyline stream URL is not currently live." };
    }

    skylineManualStreamCache.set(cameraId, {
      streamUrl,
      resolvedAt: Date.now()
    });

    return {
      ok: true,
      cameraId,
      cachedUntil: new Date(Date.now() + SKYLINE_STREAM_CACHE_TTL_MS).toISOString()
    };
  }
);
app.get("/api/v1/cameras/:cameraId/media", async (request, reply) => {
  const { cameraId } = request.params as { cameraId: string };
  const cameras = await loadCameraSources();
  const camera = cameras.find((entry) => entry.id === cameraId);

  if (!camera?.previewUrl) {
    reply.code(404);
    return { error: "Camera media not found." };
  }

  const isImageFeed =
    /\.(png|jpe?g|gif|webp)(\?|$)/i.test(camera.previewUrl) ||
    /player\.brownrice\.com\/snapshot\//i.test(camera.previewUrl);
  if (!isImageFeed) {
    reply.code(400);
    return { error: "Camera media proxy only supports image feeds." };
  }

  const upstreamResponse = await fetch(camera.previewUrl, {
    headers:
      camera.provider === "Brownrice"
        ? {
            "user-agent": "SmashAtoms-Overwatch/1.0",
            referer: "https://skirose.com/the-mountain-web-cams/"
          }
        : {
            "user-agent": "SmashAtoms-Overwatch/1.0"
          }
  });

  if (!upstreamResponse.ok) {
    reply.code(upstreamResponse.status);
    return { error: "Upstream camera media unavailable." };
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await upstreamResponse.arrayBuffer());

  reply.header("content-type", contentType);
  reply.header("cache-control", "no-store, max-age=0");
  return reply.send(buffer);
});
app.get("/api/v1/replay", async () => replay);
app.get("/api/v1/transcripts", async () => events.filter((event) => Boolean(event.transcript)));
app.get("/api/v1/weather/frames", async () => events.filter((event) => event.sourceType === "weather"));
app.get("/api/v1/dispatch/feed", async (request) => {
  const query = request.query as { limit?: string | number | undefined };
  const limitRaw = query.limit;
  const limit = typeof limitRaw === "number" ? limitRaw : Number(limitRaw ?? 50);
  return {
    items: dispatchPipeline.getFeed(Number.isFinite(limit) ? limit : 50)
  };
});
app.get("/api/v1/dispatch/streams/status", async () => ({
  enabled: dispatchPipelineEnabled,
  autostart: dispatchPipelineAutostart,
  configuredStreams: dispatchStreamUrls,
  provider: dispatchTranscriptionProvider.id,
  items: dispatchPipeline.getStatus()
}));
app.post("/api/v1/dispatch/streams/start", async (request, reply) => {
  const body = (request.body ?? {}) as { streamId?: string; sourceUrl?: string };

  if (body.streamId && body.sourceUrl) {
    dispatchPipeline.startStream(body.streamId, body.sourceUrl);
    return { ok: true, streamId: body.streamId, sourceUrl: body.sourceUrl };
  }

  if (dispatchStreamUrls.length === 0) {
    reply.code(400);
    return { ok: false, error: "No DISPATCH_STREAM_URLS configured." };
  }

  dispatchPipeline.startAll();
  return { ok: true, started: "all-configured-streams" };
});
app.post("/api/v1/dispatch/streams/stop", async (request) => {
  const body = (request.body ?? {}) as { streamId?: string };
  if (body.streamId) {
    dispatchPipeline.stopStream(body.streamId);
    return { ok: true, stopped: body.streamId };
  }
  dispatchPipeline.stopAll();
  return { ok: true, stopped: "all" };
});
app.get("/overlay", async (_, reply) => {
  const latest = dispatchPipeline.getOverlayPayload();
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dispatch Overlay</title>
    <style>
      html, body { margin:0; padding:0; background:transparent; color:#eaf4ff; font-family:Segoe UI, Arial, sans-serif; }
      .wrap { padding:16px 18px; background:rgba(5,15,27,0.5); border:1px solid rgba(123,226,209,0.3); border-radius:12px; max-width:1280px; }
      .line { font-size:34px; font-weight:700; line-height:1.15; }
      .summary { margin-top:8px; font-size:20px; color:#b7c8e4; }
      .meta { margin-top:6px; font-size:13px; color:#88a2c4; text-transform:uppercase; letter-spacing:0.06em; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="line">${latest.line}</div>
      <div class="summary">${latest.summary}</div>
      <div class="meta">Updated ${latest.timestamp}</div>
    </div>
  </body>
</html>`;
  reply.header("content-type", "text/html; charset=utf-8");
  return reply.send(html);
});
app.get("/api/v1/integrations/aerodatabox/status", async () => {
  const config = getAeroDataBoxConfig();
  return {
    configured: Boolean(config.apiKey),
    publicWebhookBaseUrl: config.publicWebhookBaseUrl,
    defaultFlightByNumberWebhookUrl: config.publicWebhookBaseUrl
      ? buildFlightByNumberWebhookUrl(config.publicWebhookBaseUrl)
      : null,
    host: config.host
  };
});
app.get("/api/v1/integrations/aerodatabox/subscriptions", async () => ({
  items: listFlightSubscriptions()
}));

app.post(
  "/api/v1/integrations/aerodatabox/subscriptions/flight-by-number/:flightNumber",
  {
    schema: {
      params: Type.Object({
        flightNumber: Type.String({ minLength: 1 })
      }),
      body: Type.Object({
        webhookUrl: Type.Optional(Type.String({ minLength: 1 })),
        useCredits: Type.Optional(Type.Boolean()),
        maxDeliveryRetries: Type.Optional(Type.Integer({ minimum: 0 }))
      })
    }
  },
  async (request, reply) => {
    const { flightNumber } = request.params as { flightNumber: string };
    const body = (request.body ?? {}) as {
      webhookUrl?: string;
      useCredits?: boolean;
      maxDeliveryRetries?: number;
    };
    const config = getAeroDataBoxConfig();
    const webhookUrl =
      body.webhookUrl ??
      (config.publicWebhookBaseUrl ? buildFlightByNumberWebhookUrl(config.publicWebhookBaseUrl) : null);

    if (!webhookUrl) {
      reply.code(400);
      return {
        error: "Webhook URL is required. Provide body.webhookUrl or set PUBLIC_WEBHOOK_BASE_URL."
      };
    }

    try {
      const result = await subscribeToFlightByNumber({
        flightNumber,
        webhookUrl,
        useCredits: body.useCredits,
        maxDeliveryRetries: body.maxDeliveryRetries
      });
      const subscriptionRecord = recordFlightSubscription({
        flightNumber,
        webhookUrl,
        useCredits: body.useCredits ?? false,
        maxDeliveryRetries: body.maxDeliveryRetries ?? 0,
        responseStatus: result.status,
        responseBody: result.body
      });

      return {
        ok: true,
        flightNumber,
        webhookUrl,
        useCredits: body.useCredits ?? false,
        maxDeliveryRetries: body.maxDeliveryRetries ?? 0,
        record: subscriptionRecord,
        subscription: result
      };
    } catch (error) {
      reply.code(502);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown AeroDataBox error"
      };
    }
  }
);

app.post("/api/v1/webhooks/aerodatabox/flight-by-number", async (request, reply) => {
  recordWebhookEvent({
    path: request.url,
    headers: request.headers as Record<string, string | string[] | undefined>,
    payload: request.body
  });

  reply.code(202);
  return {
    received: true,
    now: new Date().toISOString()
  };
});

app.get(
  "/api/v1/webhooks/aerodatabox/flight-by-number",
  {
    schema: {
      querystring: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
      })
    }
  },
  async (request) => {
    const { limit = 20 } = request.query as { limit?: number };
    return {
      items: listWebhookEvents(limit)
    };
  }
);

app.get("/api/v1/tracks/:trackId", async (request, reply) => {
  const trackId = (request.params as { trackId: string }).trackId;
  const trackEvent = events.find((event) => event.id === trackId || event.rawPayload?.callsign === trackId);

  if (!trackEvent) {
    reply.code(404);
    return { error: "Track not found" };
  }

  return trackEvent;
});

app.get("/api/v1/stream", { websocket: true }, (socket) => {
  streamClients.add(socket);

  socket.send(
    JSON.stringify({
      type: "adapter.health",
      payload: sanitizeLayerStatuses(adapterHealth)
    })
  );
  socket.send(
    JSON.stringify({
      type: "stack.upsert",
      payload: stacks
    })
  );
  socket.send(
    JSON.stringify({
      type: "dispatch.stream.status.snapshot",
      payload: dispatchPipeline.getStatus()
    })
  );
  socket.send(
    JSON.stringify({
      type: "dispatch.feed.snapshot",
      payload: dispatchPipeline.getFeed(30)
    })
  );

  const interval = setInterval(() => {
    socket.send(
      JSON.stringify({
        type: "track.update",
        payload: createMockLiveEvent(events.find((event) => event.sourceType === "aircraft") ?? events[0])
      })
    );
  }, 5000);

  socket.on("close", () => {
    clearInterval(interval);
    streamClients.delete(socket);
  });
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

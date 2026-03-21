import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Type } from "@sinclair/typebox";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
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

loadEnv({
  path: resolve(process.cwd(), "../../.env.local")
});

const app = Fastify({
  logger: true
});

const SKYLINE_SOURCE_PATTERN = /source:'([^']*m3u8\?a=[^']+)'/i;
const SKYLINE_FALLBACK_TOKENS: Record<string, string> = {
  "virginia-city/virginia-city.html": "92b5pqmocg4gevq3oligb9ca23"
};

async function resolveSkylineStreamSource(pageUrl: string): Promise<string | null> {
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

  if (!token) {
    const fallbackEntry = Object.entries(SKYLINE_FALLBACK_TOKENS).find(([pageFragment]) =>
    pageUrl.includes(pageFragment)
  );
    token = fallbackEntry?.[1] ?? null;
  }

  if (!token) {
    return null;
  }

  return `https://hd-auth.skylinewebcams.com/live.m3u8?a=${encodeURIComponent(token)}`;
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
    if (camera.provider !== "SkylineWebcams") {
      return camera;
    }

    return {
      ...camera,
      previewUrl: `${requestProtocol}://${requestHost}/api/v1/cameras/${camera.id}/stream.m3u8`
    };
  });
});
app.get("/api/v1/cameras/:cameraId/stream.m3u8", async (request, reply) => {
  const { cameraId } = request.params as { cameraId: string };
  const cameras = await loadCameraSources();
  const camera = cameras.find((entry) => entry.id === cameraId);

  if (!camera?.targetUrl || camera.provider !== "SkylineWebcams") {
    reply.code(404);
    return { error: "Camera stream not found." };
  }

  try {
    const streamUrl = await resolveSkylineStreamSource(camera.targetUrl);
    if (!streamUrl) {
      reply.code(404);
      return { error: "Live stream source unavailable." };
    }
    return reply.redirect(streamUrl);
  } catch (error) {
    request.log.warn({ error, cameraId }, "failed to resolve skyline stream");
    reply.code(502);
    return { error: "Unable to resolve Skyline live stream." };
  }
});
app.get("/api/v1/cameras/:cameraId/media", async (request, reply) => {
  const { cameraId } = request.params as { cameraId: string };
  const cameras = await loadCameraSources();
  const camera = cameras.find((entry) => entry.id === cameraId);

  if (!camera?.previewUrl) {
    reply.code(404);
    return { error: "Camera media not found." };
  }

  const isImageFeed = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(camera.previewUrl);
  if (!isImageFeed) {
    reply.code(400);
    return { error: "Camera media proxy only supports image feeds." };
  }

  const upstreamResponse = await fetch(camera.previewUrl, {
    headers: {
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
  });
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

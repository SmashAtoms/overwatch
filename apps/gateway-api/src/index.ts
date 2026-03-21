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
app.get("/api/v1/cameras", async () => loadCameraSources());
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

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
app.get("/api/v1/layers/status", async () => sanitizeLayerStatuses(adapterHealth));

app.get(
  "/api/v1/events",
  {
    schema: {
      querystring: Type.Object({
        sourceType: Type.Optional(Type.String()),
        minConfidence: Type.Optional(Type.Number())
      })
    }
  },
  async (request) => {
    const { sourceType, minConfidence } = request.query as {
      sourceType?: string;
      minConfidence?: number;
    };
    return filterEventsByQuery(events, { sourceType, minConfidence });
  }
);

app.get("/api/v1/stacks", async () => stacks);
app.get("/api/v1/cameras", async () => loadCameraSources());
app.get("/api/v1/replay", async () => replay);
app.get("/api/v1/transcripts", async () => events.filter((event) => Boolean(event.transcript)));
app.get("/api/v1/weather/frames", async () => events.filter((event) => event.sourceType === "weather"));

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
        payload: createMockLiveEvent(events[0])
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

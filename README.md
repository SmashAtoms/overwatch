# Reno SignalStack

Production-minded scaffold for a local-first situational awareness platform covering the Reno-Sparks-Fernley-Carson City-Lake Tahoe region.

## Included

- `apps/web`: Next.js operator dashboard shell with Cesium-ready map pane and live data panels
- `apps/gateway-api`: Fastify API serving region config, mock events, replay, and WebSocket updates
- `services/nlp`: FastAPI mock transcription service with cleanup and extraction stubs
- `packages/*`: shared contracts, config, renderer abstraction, UI primitives, policy helpers
- `infra/docker`: local stack for Postgres/PostGIS, Redis, MinIO, Prometheus, Grafana, gateway, web, and NLP

## Quick start

### Node apps

```bash
npm install
npm run dev
```

The web app expects the gateway API at `http://localhost:4000`.

To enable the live Google map:

```bash
copy .env.example .env.local
```

Then set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local` and restart the web app.

If you do not set a Google key yet, the app now falls back to an interactive Leaflet/OpenStreetMap base so the map still works while you build out overlays.

The current MVP map also includes a live doppler weather toggle using NOAA/NCEP radar tiles through the official OpenGeo WMS service.

To load official Nevada 511 camera markers into the map, also set `NEVADA_511_API_KEY` in the gateway environment. Without that key, the app falls back to a minimal built-in camera list.

To place an authorized scanner player directly on the dashboard, set:

```bash
NEXT_PUBLIC_BROADCASTIFY_EMBED_URL=https://your-approved-broadcastify-embed-url
```

The app will only activate the on-page scanner embed when you provide an approved embeddable player URL. Public Broadcastify listen pages are not treated as embeddable by default.

To enable AeroDataBox webhook subscriptions by flight number, also set:

```bash
RAPIDAPI_AERODATABOX_KEY=...
PUBLIC_WEBHOOK_BASE_URL=https://your-public-signalstack-host
```

Then call the gateway endpoint:

```bash
curl --request POST \
  --url http://localhost:4000/api/v1/integrations/aerodatabox/subscriptions/flight-by-number/KL1395 \
  --header "Content-Type: application/json" \
  --data "{\"maxDeliveryRetries\":0}"
```

If you do not set `PUBLIC_WEBHOOK_BASE_URL`, you can still provide the webhook URL directly:

```bash
curl --request POST \
  --url http://localhost:4000/api/v1/integrations/aerodatabox/subscriptions/flight-by-number/KL1395 \
  --header "Content-Type: application/json" \
  --data "{\"webhookUrl\":\"https://your-public-url/api/v1/webhooks/aerodatabox/flight-by-number\",\"maxDeliveryRetries\":0}"
```

Recent webhook deliveries can be inspected at `GET /api/v1/webhooks/aerodatabox/flight-by-number`.

### Python NLP service

```bash
cd services/nlp
python -m venv .venv
.venv\Scripts\activate
pip install -e .
uvicorn app.main:app --reload --port 8000
```

### Docker stack

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

## Notes

- The repo uses `npm` workspaces because `pnpm` is not installed in this environment.
- ATC and scanner adapters are scaffolded for authorized inputs only. No prohibited live feed ingestion is enabled by default.

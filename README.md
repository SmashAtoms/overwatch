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

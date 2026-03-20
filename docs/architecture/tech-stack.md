# Recommended Tech Stack

| Area | Choice | Why |
|---|---|---|
| Web app | Next.js + React + TypeScript | Strong app shell, server rendering, and future auth readiness |
| 3D map | CesiumJS-first | Best fit for terrain, altitude, and traverse-heavy regional airspace views |
| API | Fastify + TypeBox | Explicit schemas and a clean REST/WebSocket boundary |
| NLP | FastAPI + Python | Better ergonomics for STT, cleanup, extraction, and model integration |
| Data | PostgreSQL + PostGIS + Redis + MinIO | Durable history, geospatial queries, live cache, and S3-compatible blob storage |
| Observability | Prometheus + Grafana | Straightforward self-hosted metrics and dashboards |

# Deployment Plan

## Local development

- `npm install`
- `npm run dev`
- Start NLP separately from `services/nlp`
- Optional infra via `docker compose -f infra/docker/docker-compose.yml up`

## Self-hosted production

- Reverse proxy with TLS in front of web and API
- Persistent Postgres/PostGIS, Redis, and MinIO volumes
- Secrets injected via environment or secret manager
- Nightly backups for Postgres and object storage lifecycle policies

## Cloud reference

- Containerize web, gateway, and NLP services
- Use managed Postgres, Redis, and S3-compatible object storage
- Keep adapter and storage contracts provider-agnostic

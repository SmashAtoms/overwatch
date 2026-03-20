# Database Schema Draft

The initial SQL scaffold lives at `infra/docker/postgres-init/001_schema.sql` and includes:

- `source_adapter`
- `adapter_health`
- `signal_event`
- `track`
- `track_point`
- `transcript_segment`
- `extracted_entity`
- `conversation_thread`
- `information_stack`
- `stack_member`
- `weather_frame`
- `camera_source`
- `audit_log`
- `feature_flag`

Design notes:

- Geospatial columns use PostGIS geometry types in EPSG 4326.
- `signal_event` is intended to become a partitioned table as replay volume grows.
- `information_stack` persists promoted cross-signal narratives with evidence membership in `stack_member`.
- Sensitive policy actions are audited independently from signal ingestion.

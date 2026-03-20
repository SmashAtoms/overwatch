CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS source_adapter (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  policy_mode TEXT NOT NULL,
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  terms_url TEXT
);

CREATE TABLE IF NOT EXISTS adapter_health (
  adapter_id TEXT PRIMARY KEY REFERENCES source_adapter(id),
  status TEXT NOT NULL,
  lag_ms INTEGER NOT NULL DEFAULT 0,
  coverage_bbox GEOMETRY(POLYGON, 4326),
  last_success_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS signal_event (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL,
  geom GEOMETRY(POINTZ, 4326),
  altitude_m DOUBLE PRECISION,
  confidence DOUBLE PRECISION NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS track (
  id TEXT PRIMARY KEY,
  track_type TEXT NOT NULL,
  callsign TEXT,
  icao24 TEXT,
  origin_code TEXT,
  destination_code TEXT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS track_point (
  track_id TEXT REFERENCES track(id),
  ts TIMESTAMPTZ NOT NULL,
  geom GEOMETRY(POINTZ, 4326) NOT NULL,
  altitude_m DOUBLE PRECISION,
  heading_deg DOUBLE PRECISION,
  speed_kt DOUBLE PRECISION,
  vertical_rate_fpm DOUBLE PRECISION,
  PRIMARY KEY (track_id, ts)
);

CREATE TABLE IF NOT EXISTS transcript_segment (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES signal_event(id),
  channel TEXT NOT NULL,
  speaker_label TEXT,
  raw_text TEXT NOT NULL,
  clean_text TEXT,
  language TEXT DEFAULT 'en',
  confidence DOUBLE PRECISION,
  start_ms INTEGER,
  end_ms INTEGER
);

CREATE TABLE IF NOT EXISTS extracted_entity (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES signal_event(id),
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT,
  confidence DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_thread (
  id TEXT PRIMARY KEY,
  thread_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  centroid GEOMETRY(POINT, 4326),
  summary TEXT
);

CREATE TABLE IF NOT EXISTS information_stack (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  centroid GEOMETRY(POINTZ, 4326),
  time_window TSRANGE,
  summary TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  plain_english TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stack_member (
  stack_id TEXT REFERENCES information_stack(id),
  member_type TEXT NOT NULL,
  member_id TEXT NOT NULL,
  weight DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (stack_id, member_type, member_id)
);

CREATE TABLE IF NOT EXISTS weather_frame (
  id TEXT PRIMARY KEY,
  layer_type TEXT NOT NULL,
  frame_ts TIMESTAMPTZ NOT NULL,
  tile_url TEXT NOT NULL,
  bbox GEOMETRY(POLYGON, 4326),
  severity TEXT
);

CREATE TABLE IF NOT EXISTS camera_source (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  geom GEOMETRY(POINT, 4326) NOT NULL,
  embed_mode TEXT NOT NULL,
  target_url TEXT NOT NULL,
  preview_url TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS feature_flag (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  scope TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

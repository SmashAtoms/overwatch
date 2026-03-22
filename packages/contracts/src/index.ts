export type SourceKind = "aircraft" | "atc" | "scanner" | "weather" | "camera";

export type SourceStatus = "healthy" | "degraded" | "offline" | "restricted";
export type PolicyMode = "enabled" | "link_only" | "delayed" | "disabled";

export type GeoPoint = {
  lon: number;
  lat: number;
  altM?: number | null;
};

export type RegionConfig = {
  id: string;
  name: string;
  center: {
    lon: number;
    lat: number;
    altitudeM: number;
  };
  bbox: [number, number, number, number];
  expansionKmSteps: number[];
  savedViewpoints: Array<{
    id: string;
    name: string;
    point: GeoPoint;
    headingDeg: number;
    pitchDeg: number;
  }>;
};

export type AdapterHealth = {
  adapterId: string;
  kind: SourceKind;
  status: SourceStatus;
  lagMs: number;
  lastSuccessAt: string | null;
  coverageBbox: [number, number, number, number] | null;
  policyMode: PolicyMode;
};

export type ExtractedEntity = {
  kind: string;
  value: string;
  confidence: number;
};

export type TranscriptArtifact = {
  channel: string;
  speakerLabel: string;
  rawText: string;
  cleanText: string;
  language: string;
  startMs: number;
  endMs: number;
  modelConfidence: number;
  ruleConfidence: number;
};

export type SignalEvent = {
  id: string;
  sourceType: SourceKind;
  eventType: string;
  occurredAt: string;
  ingestedAt: string;
  point: GeoPoint;
  confidence: number;
  summary: string;
  transcript: TranscriptArtifact | null;
  entities?: ExtractedEntity[];
  rawPayload?: Record<string, unknown>;
};

export type InformationStack = {
  id: string;
  title: string;
  status: "live" | "recent" | "resolved" | "stale";
  timeWindow: {
    start: string;
    end: string;
  };
  centroid: GeoPoint;
  sources: SourceKind[];
  entities?: ExtractedEntity[];
  confidence: number;
  summary: string;
  plainEnglish: string;
  mapJump: {
    bbox: [number, number, number, number];
  };
  evidence: Array<{
    sourceType: SourceKind;
    sourceId: string;
    reason: string;
    weight: number;
  }>;
  policy: {
    delayed: boolean;
    restricted: boolean;
    notes: string[];
  };
};

export type ReplayFrame = {
  ts: string;
  cursor: string;
  counts: {
    events: number;
    stacks: number;
  };
};

export type ReplayFrameSet = {
  range: "15m" | "1h" | "6h" | "24h";
  generatedAt: string;
  frames: ReplayFrame[];
};

export type CameraSource = {
  id: string;
  name: string;
  provider: string;
  point: Omit<GeoPoint, "altM">;
  embedMode: "embed" | "link_only";
  targetUrl: string;
  previewUrl: string | null;
  status: "active" | "offline";
};

export type DispatchPriority = "low" | "medium" | "high";

export type DispatchSummaryWindow = "2m" | "30m";

export type DispatchParseResult = {
  type: string;
  location: string;
  priority: DispatchPriority;
  units: string[];
  summary: string;
  tags: string[];
  confidence: number;
};

export type DispatchSegmentInterim = {
  streamId: string;
  segmentId: string;
  sequence: number;
  receivedAt: string;
  finalized: false;
  text: string;
};

export type DispatchSegmentFinalized = {
  streamId: string;
  segmentId: string;
  sequence: number;
  receivedAt: string;
  finalized: true;
  rawTranscript: string;
  cleanSentence: string;
  parse: DispatchParseResult;
};

export type DispatchCard = {
  id: string;
  streamId: string;
  segmentId: string;
  sequence: number;
  timestamp: string;
  rawTranscript: string;
  cleanSentence: string;
  summaryBullets: string[];
  tags: string[];
  incidentType: string;
  location: string;
  units: string[];
  priority: DispatchPriority;
  confidence: number;
};

export type DispatchSummaryWindowEvent = {
  id: string;
  streamId: string;
  window: DispatchSummaryWindow;
  from: string;
  to: string;
  timestamp: string;
  bulletSummary: string[];
  tags: string[];
  cardIds: string[];
};

export type DispatchStreamStatus = {
  streamId: string;
  sourceUrl: string;
  state: "idle" | "running" | "stopped" | "error";
  startedAt: string | null;
  stoppedAt: string | null;
  lastError: string | null;
  sequence: number;
  receivedSegments: number;
  finalizedSegments: number;
};

export interface NormalizedEnvelope<TPayload = unknown> {
  id: string;
  adapterId: string;
  kind: SourceKind;
  occurredAt: string;
  observedAt: string;
  bbox?: [number, number, number, number];
  point?: GeoPoint;
  confidence: number;
  rawRef?: string | null;
  payload: TPayload;
}

export interface SourceAdapter<TConfig = unknown> {
  id: string;
  kind: SourceKind;
  start(config: TConfig): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<AdapterHealth>;
}

export interface PullAdapter<TConfig = unknown> extends SourceAdapter<TConfig> {
  poll(since?: string): Promise<Array<NormalizedEnvelope>>;
}

export interface StreamAdapter<TConfig = unknown> extends SourceAdapter<TConfig> {
  subscribe(emit: (event: NormalizedEnvelope) => Promise<void>): Promise<void>;
}

export const DEFAULT_REGION: RegionConfig = {
  id: "reno-signalstack-default",
  name: "Reno-Sparks-Fernley-Carson City-Tahoe",
  center: {
    lon: -119.8138,
    lat: 39.5296,
    altitudeM: 1347
  },
  bbox: [-120.37, 38.45, -118.48, 39.95],
  expansionKmSteps: [25, 50, 75, 100],
  savedViewpoints: [
    {
      id: "krno",
      name: "KRNO",
      point: { lon: -119.7681, lat: 39.4991, altM: 1347 },
      headingDeg: 172,
      pitchDeg: -28
    },
    {
      id: "tahoe-basin",
      name: "Tahoe Basin",
      point: { lon: -120.0324, lat: 39.0968, altM: 1897 },
      headingDeg: 32,
      pitchDeg: -33
    },
    {
      id: "carson-corridor",
      name: "Carson Corridor",
      point: { lon: -119.7674, lat: 39.1638, altM: 1432 },
      headingDeg: 8,
      pitchDeg: -24
    },
    {
      id: "fernley-corridor",
      name: "Fernley Corridor",
      point: { lon: -119.251, lat: 39.6074, altM: 1250 },
      headingDeg: 278,
      pitchDeg: -26
    }
  ]
};

export const DEFAULT_VIEWPOINTS = DEFAULT_REGION.savedViewpoints;

import type {
  AdapterHealth,
  CameraSource,
  InformationStack,
  ReplayFrameSet,
  SignalEvent
} from "@signalstack/contracts";

const API_BASE =
  process.env.GATEWAY_API_URL ?? process.env.NEXT_PUBLIC_GATEWAY_API_URL ?? "http://127.0.0.1:4000";

export type FlightSubscriptionRecord = {
  id: string;
  flightNumber: string;
  webhookUrl: string;
  useCredits: boolean;
  maxDeliveryRetries: number;
  createdAt: string;
  lastResponseStatus: number;
  lastResponseBody: unknown;
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchJsonOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(path);
  } catch {
    return fallback;
  }
}

export async function fetchDashboardData(): Promise<{
  layers: AdapterHealth[];
  events: SignalEvent[];
  stacks: InformationStack[];
  cameras: CameraSource[];
  replay: ReplayFrameSet;
  flightSubscriptions: FlightSubscriptionRecord[];
}> {
  const replayFallback: ReplayFrameSet = {
    range: "15m",
    generatedAt: new Date().toISOString(),
    frames: []
  };

  const [layers, events, stacks, cameras, replay, subscriptions] = await Promise.all([
    fetchJsonOrDefault<AdapterHealth[]>("/api/v1/layers/status", []),
    fetchJsonOrDefault<SignalEvent[]>("/api/v1/events", []),
    fetchJsonOrDefault<InformationStack[]>("/api/v1/stacks", []),
    fetchJsonOrDefault<CameraSource[]>("/api/v1/cameras", []),
    fetchJsonOrDefault<ReplayFrameSet>("/api/v1/replay", replayFallback),
    fetchJsonOrDefault<{ items: FlightSubscriptionRecord[] }>(
      "/api/v1/integrations/aerodatabox/subscriptions",
      { items: [] }
    )
  ]);

  return {
    layers,
    events,
    stacks,
    cameras,
    replay,
    flightSubscriptions: subscriptions.items
  };
}

import type {
  AdapterHealth,
  CameraSource,
  InformationStack,
  ReplayFrameSet,
  SignalEvent
} from "@signalstack/contracts";

const API_BASE = process.env.GATEWAY_API_URL ?? "http://localhost:4000";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchDashboardData(): Promise<{
  layers: AdapterHealth[];
  events: SignalEvent[];
  stacks: InformationStack[];
  cameras: CameraSource[];
  replay: ReplayFrameSet;
}> {
  const [layers, events, stacks, cameras, replay] = await Promise.all([
    fetchJson<AdapterHealth[]>("/api/v1/layers/status"),
    fetchJson<SignalEvent[]>("/api/v1/events"),
    fetchJson<InformationStack[]>("/api/v1/stacks"),
    fetchJson<CameraSource[]>("/api/v1/cameras"),
    fetchJson<ReplayFrameSet>("/api/v1/replay")
  ]);

  return {
    layers,
    events,
    stacks,
    cameras,
    replay
  };
}

import type { AdapterHealth, ReplayFrameSet, SignalEvent } from "@signalstack/contracts";

export function formatLagLabel(lagMs: number): string {
  if (lagMs < 1000) {
    return `${lagMs} ms`;
  }

  return `${Math.round(lagMs / 1000)}s lag`;
}

export function summarizeLayerStatus(items: AdapterHealth[]): string {
  const healthy = items.filter((item) => item.status === "healthy").length;
  return `${healthy}/${items.length} healthy`;
}

export function sanitizeLayerStatuses(items: AdapterHealth[]): AdapterHealth[] {
  return items.map((item) => ({
    ...item,
    lastSuccessAt: item.lastSuccessAt
  }));
}

export function filterEventsByQuery(
  events: SignalEvent[],
  query: { sourceType?: string; minConfidence?: number }
): SignalEvent[] {
  return events.filter((event) => {
    if (query.sourceType && event.sourceType !== query.sourceType) {
      return false;
    }

    if (typeof query.minConfidence === "number" && event.confidence < query.minConfidence) {
      return false;
    }

    return true;
  });
}

export function createMockLiveEvent(event: SignalEvent): SignalEvent {
  return {
    ...event,
    occurredAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    point: {
      ...event.point,
      lon: event.point.lon + 0.0015,
      lat: event.point.lat + 0.0008
    }
  };
}

export function buildReplayMarks(replay: ReplayFrameSet): Array<{
  label: string;
  value: number;
  caption: string;
}> {
  return replay.frames.map((frame) => ({
    label: new Date(frame.ts).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    }),
    value: frame.counts.events,
    caption: `${frame.counts.events} ev / ${frame.counts.stacks} stacks`
  }));
}

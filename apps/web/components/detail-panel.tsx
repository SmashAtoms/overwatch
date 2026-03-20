import type { SignalEvent } from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";

type DetailPanelProps = {
  event?: SignalEvent;
};

export function DetailPanel({ event }: DetailPanelProps) {
  if (!event) {
    return (
      <div className="detail-card">
        <p>No event selected.</p>
      </div>
    );
  }

  const entities = event.entities ?? [];

  return (
    <div className="detail-grid">
      <div className="detail-card">
        <div className="detail-meta">
          <Badge tone="accent">{event.sourceType}</Badge>
          <Badge tone="neutral">{event.eventType}</Badge>
          <Badge tone="neutral">{event.occurredAt}</Badge>
        </div>
        <dl>
          <dt>ID</dt>
          <dd>{event.id}</dd>
          <dt>Location</dt>
          <dd>
            {event.point.lat.toFixed(4)}, {event.point.lon.toFixed(4)}
          </dd>
          <dt>Altitude</dt>
          <dd>{event.point.altM ? `${Math.round(event.point.altM)} m` : "surface / n.a."}</dd>
          <dt>Summary</dt>
          <dd>{event.summary}</dd>
        </dl>
      </div>
      <div className="detail-card">
        <strong>Extracted entities</strong>
        <div className="detail-meta">
          {entities.map((entity) => (
            <Badge key={`${entity.kind}-${entity.value}`} tone="neutral">
              {entity.kind}: {entity.value}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

import type { SignalEvent } from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";

type RenoAtcPanelProps = {
  events: SignalEvent[];
};

function formatPacificTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

export function RenoAtcPanel({ events }: RenoAtcPanelProps) {
  const atcEvents = events
    .filter((event) => event.sourceType === "atc" && event.transcript)
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  const latestAtcEvent = atcEvents[0] ?? null;

  return (
    <div className="reno-atc-panel">
      <div className="reno-atc-header">
        <div>
          <div className="reno-atc-kicker">Reno Airport ATC</div>
          <strong className="reno-atc-title">Reno-Tahoe International Airport radio stream</strong>
          <p className="reno-atc-subtitle">
            KRNO tower and approach audio is available here as a compliant LiveATC link-out.
          </p>
        </div>
        <div className="reno-atc-badges">
          <Badge tone="accent">KRNO</Badge>
          <Badge tone="neutral">LiveATC link</Badge>
        </div>
      </div>

      <div className="reno-atc-actions">
        <a
          className="reno-atc-link"
          href="https://www.liveatc.net/search/?icao=krno"
          target="_blank"
          rel="noreferrer"
        >
          Open KRNO radio stream
        </a>
        {latestAtcEvent ? (
          <span className="reno-atc-meta">
            Latest transcript: {formatPacificTime(latestAtcEvent.occurredAt)}
          </span>
        ) : (
          <span className="reno-atc-meta">Latest transcript: none yet</span>
        )}
      </div>
    </div>
  );
}

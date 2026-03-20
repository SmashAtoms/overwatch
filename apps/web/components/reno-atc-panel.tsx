import type { SignalEvent } from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";

type RenoAtcPanelProps = {
  events: SignalEvent[];
};

const PACIFIC_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short"
});

function formatPacificTime(value: string | Date) {
  return PACIFIC_FORMATTER.format(new Date(value));
}

export function RenoAtcPanel({ events }: RenoAtcPanelProps) {
  const atcEvents = events
    .filter((event) => event.sourceType === "atc" && event.transcript)
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  const latestAtcEvent = atcEvents[0] ?? null;
  const nowPacific = formatPacificTime(new Date());

  return (
    <div className="reno-atc-panel">
      <div className="reno-atc-header">
        <div>
          <div className="reno-atc-kicker">Reno Airport ATC</div>
          <strong className="reno-atc-title">KRNO tower and approach transcript workspace</strong>
          <p className="reno-atc-subtitle">
            Pacific time now: {nowPacific}. LiveATC audio remains link-out only unless separately authorized.
          </p>
        </div>
        <div className="reno-atc-badges">
          <Badge tone="accent">KRNO</Badge>
          <Badge tone="neutral">{latestAtcEvent ? "ATC transcript ready" : "Waiting for ATC feed"}</Badge>
        </div>
      </div>

      <div className="reno-atc-actions">
        <a
          className="reno-atc-link"
          href="https://www.liveatc.net/hlisten.php?mount=krno&icao=krno"
          target="_blank"
          rel="noreferrer"
        >
          Open LiveATC link
        </a>
        {latestAtcEvent ? (
          <span className="reno-atc-meta">
            Latest transcript: {formatPacificTime(latestAtcEvent.occurredAt)}
          </span>
        ) : (
          <span className="reno-atc-meta">Latest transcript: none yet</span>
        )}
      </div>

      {latestAtcEvent ? (
        <div className="reno-atc-grid">
          {atcEvents.slice(0, 3).map((event) => (
            <article key={event.id} className="reno-atc-card">
              <div className="reno-atc-card-meta">
                <Badge tone="neutral">{event.transcript?.channel ?? "KRNO ATC"}</Badge>
                <Badge tone="neutral">{formatPacificTime(event.occurredAt)}</Badge>
                <Badge tone="neutral">{Math.round(event.confidence * 100)}% confidence</Badge>
              </div>
              <div className="reno-atc-card-grid">
                <div className="reno-atc-block">
                  <label>Raw</label>
                  <div>{event.transcript?.rawText ?? "Unavailable"}</div>
                </div>
                <div className="reno-atc-block">
                  <label>Clean</label>
                  <div>{event.transcript?.cleanText ?? "Unavailable"}</div>
                </div>
                <div className="reno-atc-block">
                  <label>Summary</label>
                  <div>{event.summary}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="reno-atc-empty">
          No KRNO transcript events are available yet. This panel is ready for an authorized live ATC audio
          source and already formats transcript times in Pacific time.
        </div>
      )}
    </div>
  );
}

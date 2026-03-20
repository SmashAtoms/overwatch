import type { SignalEvent } from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";

type RenoScannerPanelProps = {
  events: SignalEvent[];
};

const AUTHORIZED_BROADCASTIFY_EMBED_URL = process.env.NEXT_PUBLIC_BROADCASTIFY_EMBED_URL?.trim() ?? "";

const PACIFIC_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short"
});

const CODEWORD_LOOKUP: Record<string, string> = {
  bolo: "Be on the lookout",
  code3: "Respond with lights and siren",
  "code 3": "Respond with lights and siren",
  code4: "Situation appears stable / no further urgent units needed",
  "code 4": "Situation appears stable / no further urgent units needed",
  1015: "Person in custody",
  "10-15": "Person in custody",
  1097: "Unit has arrived on scene",
  "10-97": "Unit has arrived on scene",
  1098: "Unit assignment complete",
  "10-98": "Unit assignment complete"
};

function formatPacificTime(value: string | Date) {
  return PACIFIC_FORMATTER.format(new Date(value));
}

function findCodeWords(text: string) {
  const normalized = text.toLowerCase();
  return Object.entries(CODEWORD_LOOKUP)
    .filter(([code]) => normalized.includes(code))
    .map(([code, meaning]) => ({ code, meaning }));
}

function deriveSpeakerLabel(event: SignalEvent) {
  const explicit = event.transcript?.speakerLabel;
  if (explicit?.trim()) {
    return explicit;
  }

  const agency = typeof event.rawPayload?.agency === "string" ? event.rawPayload.agency : null;
  return agency ?? "unknown speaker";
}

export function RenoScannerPanel({ events }: RenoScannerPanelProps) {
  const scannerEvents = events
    .filter((event) => event.sourceType === "scanner" && event.transcript)
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  const latestEvent = scannerEvents[0] ?? null;
  const nowPacific = formatPacificTime(new Date());
  const codeWords = latestEvent
    ? findCodeWords(
        `${latestEvent.transcript?.rawText ?? ""} ${latestEvent.transcript?.cleanText ?? ""} ${latestEvent.summary}`
      )
    : [];
  const embedEnabled = AUTHORIZED_BROADCASTIFY_EMBED_URL.length > 0;

  return (
    <div className="reno-scanner-panel">
      <div className="reno-scanner-header">
        <div>
          <div className="reno-scanner-kicker">RNO Police / EMS</div>
          <strong className="reno-scanner-title">Live audio, transcript, and code-word workspace</strong>
          <p className="reno-scanner-subtitle">
            Pacific time now: {nowPacific}. The player below only activates when an authorized Broadcastify
            embed URL is configured for this dashboard.
          </p>
        </div>
        <div className="reno-scanner-badges">
          <Badge tone="accent">Scanner</Badge>
          <Badge tone="neutral">{embedEnabled ? "Embed ready" : "Embed pending"}</Badge>
          <Badge tone="neutral">{latestEvent ? "Transcript ready" : "Waiting for feed"}</Badge>
        </div>
      </div>

      <div className="reno-scanner-layout">
        <article className="reno-scanner-audio-card">
          <div className="reno-scanner-audio-head">
            <div>
              <strong>Live audio stage</strong>
              <p className="reno-scanner-audio-copy">
                Keep this feed on-page while transcript and code interpretation update beside it.
              </p>
            </div>
            <div className="reno-scanner-audio-badges">
              <Badge tone={embedEnabled ? "accent" : "neutral"}>{embedEnabled ? "Embedded" : "Awaiting URL"}</Badge>
              <Badge tone="neutral">Pacific time</Badge>
            </div>
          </div>

          <div className="reno-scanner-player-box">
            {embedEnabled ? (
              <iframe
                title="RNO Police EMS Broadcastify player"
                src={AUTHORIZED_BROADCASTIFY_EMBED_URL}
                className="reno-scanner-player-frame"
                allow="autoplay"
              />
            ) : (
              <div className="reno-scanner-player-placeholder">
                <strong>Authorized embed URL required</strong>
                <span>
                  Set <code>NEXT_PUBLIC_BROADCASTIFY_EMBED_URL</code> to your approved Broadcastify embed URL or
                  another licensed scanner player source.
                </span>
              </div>
            )}
          </div>

          <div className="reno-scanner-actions">
            <a
              className="reno-scanner-link"
              href="https://www.broadcastify.com/listen/feed/7364"
              target="_blank"
              rel="noreferrer"
            >
              Open source page
            </a>
            {latestEvent ? (
              <span className="reno-scanner-meta">Latest transcript: {formatPacificTime(latestEvent.occurredAt)}</span>
            ) : (
              <span className="reno-scanner-meta">Latest transcript: none yet</span>
            )}
          </div>
        </article>

        {latestEvent ? (
          <div className="reno-scanner-grid">
            <article className="reno-scanner-card">
              <div className="reno-scanner-card-meta">
                <Badge tone="neutral">{latestEvent.transcript?.channel ?? "RNO Police / EMS"}</Badge>
                <Badge tone="neutral">{formatPacificTime(latestEvent.occurredAt)}</Badge>
                <Badge tone="neutral">{Math.round(latestEvent.confidence * 100)}% confidence</Badge>
              </div>
              <div className="reno-scanner-card-grid">
                <div className="reno-scanner-block">
                  <label>Speaker</label>
                  <div>{deriveSpeakerLabel(latestEvent)}</div>
                </div>
                <div className="reno-scanner-block">
                  <label>Raw audio text</label>
                  <div>{latestEvent.transcript?.rawText ?? "Unavailable"}</div>
                </div>
                <div className="reno-scanner-block">
                  <label>Clean transcript</label>
                  <div>{latestEvent.transcript?.cleanText ?? "Unavailable"}</div>
                </div>
              </div>
            </article>

            <article className="reno-scanner-card">
              <div className="reno-scanner-side-title">Interpretation</div>
              <div className="reno-scanner-side-stack">
                <div className="reno-scanner-block">
                  <label>Summary</label>
                  <div>{latestEvent.summary}</div>
                </div>
                <div className="reno-scanner-block">
                  <label>Extracted entities</label>
                  <div className="reno-scanner-entity-list">
                    {(latestEvent.entities ?? []).map((entity) => (
                      <Badge key={`${entity.kind}-${entity.value}`} tone="neutral">
                        {entity.kind}: {entity.value}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="reno-scanner-block">
                  <label>Detected code words</label>
                  {codeWords.length > 0 ? (
                    <div className="reno-scanner-code-list">
                      {codeWords.map((codeWord) => (
                        <div key={`${codeWord.code}-${codeWord.meaning}`} className="reno-scanner-code-item">
                          <strong>{codeWord.code}</strong>
                          <span>{codeWord.meaning}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>No code words detected in the current transcript sample.</div>
                  )}
                </div>
              </div>
            </article>
          </div>
        ) : (
          <div className="reno-scanner-empty">
            No scanner transcript events are available yet. This section is ready for an authorized public-safety
            audio source and code-word interpretation rules.
          </div>
        )}
      </div>
    </div>
  );
}

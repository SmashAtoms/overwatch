import type { SignalEvent } from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";

type TranscriptFeedProps = {
  events: SignalEvent[];
};

export function TranscriptFeed({ events }: TranscriptFeedProps) {
  const transcriptEvents = events.filter((event) => event.transcript);

  return (
    <div className="transcript-list">
      {transcriptEvents.map((event) => (
        <article key={event.id} className="transcript-card">
          <div className="transcript-meta">
            <Badge tone="accent">{event.sourceType}</Badge>
            <Badge tone="neutral">{event.eventType}</Badge>
            <Badge tone="neutral">{Math.round(event.confidence * 100)}% confidence</Badge>
            {event.transcript?.channel ? <Badge tone="neutral">{event.transcript.channel}</Badge> : null}
          </div>
          <div className="transcript-grid">
            <div className="transcript-block">
              <label>Raw</label>
              <div>{event.transcript?.rawText ?? "Unavailable"}</div>
            </div>
            <div className="transcript-block">
              <label>Clean</label>
              <div>{event.transcript?.cleanText ?? "Unavailable"}</div>
            </div>
            <div className="transcript-block">
              <label>Summary</label>
              <div>{event.summary}</div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

"use client";

import type { DispatchCard } from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";

type EventCardProps = {
  card: DispatchCard;
};

export function EventCard({ card }: EventCardProps) {
  return (
    <article className="live-event-card">
      <div className="live-event-meta">
        <Badge tone="neutral">{new Date(card.timestamp).toLocaleTimeString()}</Badge>
        <Badge tone="neutral">{card.incidentType}</Badge>
        <Badge tone={card.priority === "high" ? "accent" : "neutral"}>{card.priority.toUpperCase()}</Badge>
      </div>
      <div className="live-event-text">
        <label>Raw transcript</label>
        <div>{card.rawTranscript}</div>
      </div>
      <div className="live-event-text">
        <label>Structured summary</label>
        <div>{card.summaryBullets[0] ?? card.cleanSentence}</div>
      </div>
      <div className="live-event-tag-row">
        {card.tags.slice(0, 6).map((tag) => (
          <Badge key={`${card.id}-${tag}`} tone="neutral">
            {tag}
          </Badge>
        ))}
      </div>
      <div className="live-event-units">
        Units: {card.units.length > 0 ? card.units.join(", ") : "pending"} | Location: {card.location}
      </div>
    </article>
  );
}


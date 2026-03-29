 "use client";

import { useRef, useState } from "react";
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
  const KRNO_LIVEATC_PAGE_URL = "https://www.liveatc.net/hlisten.php?mount=krno&icao=krno";
  const directAtcStreamUrl =
    process.env.NEXT_PUBLIC_KRNO_ATC_STREAM_URL?.trim() ??
    "https://s1-bos.liveatc.net/krno?nocache=2026032911141034866";
  const atcAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const atcEvents = events
    .filter((event) => event.sourceType === "atc" && event.transcript)
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  const latestAtcEvent = atcEvents[0] ?? null;
  const canControlDirectAudio = directAtcStreamUrl.length > 0;
  async function toggleAtcPlayback() {
    const player = atcAudioRef.current;
    if (!player) {
      return;
    }

    if (player.paused) {
      try {
        await player.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
      return;
    }

    player.pause();
    setIsPlaying(false);
  }

  return (
    <div className="reno-atc-panel">
      <article className="reno-atc-audio-card">
        <div className="reno-atc-audio-head">
          <div>
            <strong>Live KRNO radio audio</strong>
            <p className="reno-atc-audio-copy">
              Monitor Reno tower and approach audio directly in this panel.
            </p>
          </div>
          <div className="reno-atc-audio-badges">
            <Badge tone={isPlaying ? "accent" : "neutral"}>{isPlaying ? "Audio playing" : "Audio paused"}</Badge>
            <Badge tone="neutral">{canControlDirectAudio ? "Direct" : "Embedded"}</Badge>
          </div>
        </div>

        <div className={`reno-atc-player-box ${isPlaying ? "is-live" : "is-dimmed"}`}>
          {canControlDirectAudio ? (
            <div className="reno-atc-direct-player">
              <audio
                ref={atcAudioRef}
                className="reno-atc-audio-element"
                controls
                preload="none"
                src={directAtcStreamUrl}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              >
                Your browser does not support the live audio element.
              </audio>
              <div className="reno-atc-direct-note">KRNO direct stream connected.</div>
            </div>
          ) : (
            <iframe
              title="KRNO LiveATC stream player"
              src={KRNO_LIVEATC_PAGE_URL}
              className="reno-atc-player-frame"
              allow="autoplay"
            />
          )}
        </div>
      </article>

      <div className="reno-atc-actions">
        {canControlDirectAudio ? (
          <button type="button" className="reno-atc-link" onClick={() => void toggleAtcPlayback()}>
            {isPlaying ? "Pause KRNO audio" : "Play KRNO audio"}
          </button>
        ) : null}
        <a
          className="reno-atc-link"
          href={KRNO_LIVEATC_PAGE_URL}
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

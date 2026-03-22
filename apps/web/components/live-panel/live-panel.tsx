"use client";

import { useEffect, useMemo, useState } from "react";
import type { DispatchCard, DispatchSummaryWindowEvent } from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";
import { EventCard } from "./event-card";

type LivePanelProps = {
  liveAudioActive: boolean;
};

type StreamStatus = {
  streamId: string;
  state: "idle" | "running" | "stopped" | "error";
  finalizedSegments: number;
};

const GATEWAY_API_BASE =
  process.env.NEXT_PUBLIC_GATEWAY_API_URL ?? process.env.GATEWAY_API_URL ?? "http://127.0.0.1:4000";

function toWsUrl(baseUrl: string) {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/v1/stream";
  parsed.search = "";
  return parsed.toString();
}

function formatPacificDateTime(epochMs: number | null) {
  if (!epochMs) {
    return "--";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(epochMs));
}

function formatDuration(totalMs: number) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function LivePanel({ liveAudioActive }: LivePanelProps) {
  const [cards, setCards] = useState<DispatchCard[]>([]);
  const [summary2m, setSummary2m] = useState<DispatchSummaryWindowEvent[]>([]);
  const [summary30m, setSummary30m] = useState<DispatchSummaryWindowEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus[]>([]);
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [sessionStartedAtMs, setSessionStartedAtMs] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const ws = new WebSocket(toWsUrl(GATEWAY_API_BASE));
    setConnection("connecting");

    ws.onopen = () => {
      setConnection("connected");
    };

    ws.onclose = () => {
      setConnection("disconnected");
    };

    ws.onmessage = (event) => {
      let payload: { type: string; payload: unknown };
      try {
        payload = JSON.parse(event.data) as { type: string; payload: unknown };
      } catch {
        return;
      }

      switch (payload.type) {
        case "dispatch.card.upsert":
          if (!liveAudioActive) {
            break;
          }
          setCards((current) => {
            const next = payload.payload as DispatchCard;
            const deduped = current.filter((item) => item.id !== next.id);
            return [next, ...deduped].slice(0, 60);
          });
          break;
        case "dispatch.feed.snapshot":
          if (!liveAudioActive) {
            setCards([]);
            break;
          }
          setCards((payload.payload as DispatchCard[]) ?? []);
          break;
        case "dispatch.summary.2min.upsert":
          if (!liveAudioActive) {
            break;
          }
          setSummary2m((current) => {
            const next = payload.payload as DispatchSummaryWindowEvent;
            return [next, ...current.filter((item) => item.id !== next.id)].slice(0, 10);
          });
          break;
        case "dispatch.summary.30min.upsert":
          if (!liveAudioActive) {
            break;
          }
          setSummary30m((current) => {
            const next = payload.payload as DispatchSummaryWindowEvent;
            return [next, ...current.filter((item) => item.id !== next.id)].slice(0, 10);
          });
          break;
        case "dispatch.stream.status":
          setStatus((current) => {
            const next = payload.payload as StreamStatus;
            const deduped = current.filter((item) => item.streamId !== next.streamId);
            return [next, ...deduped];
          });
          break;
        case "dispatch.stream.status.snapshot":
          setStatus((payload.payload as StreamStatus[]) ?? []);
          break;
        default:
          break;
      }
    };

    return () => {
      ws.close();
    };
  }, [liveAudioActive]);

  useEffect(() => {
    if (liveAudioActive) {
      setCards([]);
      setSummary2m([]);
      setSummary30m([]);
      setSessionStartedAtMs(Date.now());
      setElapsedMs(0);
      return;
    }

    setSessionStartedAtMs(null);
    setElapsedMs(0);
  }, [liveAudioActive]);

  useEffect(() => {
    if (!liveAudioActive || !sessionStartedAtMs) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - sessionStartedAtMs);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [liveAudioActive, sessionStartedAtMs]);

  const connectionBadge = useMemo(() => {
    if (connection === "connected") {
      return "WS connected";
    }
    if (connection === "connecting") {
      return "WS connecting";
    }
    return "WS disconnected";
  }, [connection]);

  const runningStreams = status.filter((item) => item.state === "running").length;
  const sessionStatusLabel = liveAudioActive ? "Live" : "Idle";

  return (
    <div className="live-panel">
      <div className="live-panel-header">
        <div>
          <strong>Dispatch intelligence feed</strong>
          <p>Blank at startup. Cards and summaries appear only during a live audio session.</p>
        </div>
        <div className="live-panel-badges">
          <Badge tone="neutral">{connectionBadge}</Badge>
          <Badge tone="neutral">{cards.length} cards</Badge>
          <Badge tone="neutral">{runningStreams} running streams</Badge>
        </div>
      </div>

      <div className="live-session-state">
        <div>
          <label>Session start</label>
          <strong>{formatPacificDateTime(sessionStartedAtMs)}</strong>
        </div>
        <div>
          <label>Duration</label>
          <strong>{formatDuration(elapsedMs)}</strong>
        </div>
        <div>
          <label>State</label>
          <strong>{sessionStatusLabel}</strong>
        </div>
      </div>

      {!liveAudioActive ? (
        <div className="live-panel-empty live-panel-empty-large">
          Dispatch intelligence is idle. Start <strong>Pipeline On</strong> and <strong>Play Radio</strong> to open a
          new session.
        </div>
      ) : null}

      {liveAudioActive ? (
        <div className="live-panel-grid">
          <div className="live-panel-feed">
            {cards.length > 0 ? (
              cards.map((card) => <EventCard key={card.id} card={card} />)
            ) : (
              <div className="live-panel-empty">Listening... finalized cards will appear shortly.</div>
            )}
          </div>

          <div className="live-panel-summaries">
            <div className="live-summary-card">
              <strong>2-minute summaries</strong>
              {summary2m.length > 0 ? (
                summary2m.slice(0, 4).map((item) => (
                  <div key={item.id} className="live-summary-item">
                    <Badge tone="accent">{new Date(item.timestamp).toLocaleTimeString()}</Badge>
                    <span>{item.bulletSummary[0]}</span>
                  </div>
                ))
              ) : (
                <div className="live-panel-empty">No 2-minute summary yet.</div>
              )}
            </div>

            <div className="live-summary-card">
              <strong>30-minute summaries</strong>
              {summary30m.length > 0 ? (
                summary30m.slice(0, 4).map((item) => (
                  <div key={item.id} className="live-summary-item">
                    <Badge tone="neutral">{new Date(item.timestamp).toLocaleTimeString()}</Badge>
                    <span>{item.bulletSummary[0]}</span>
                  </div>
                ))
              ) : (
                <div className="live-panel-empty">No 30-minute summary yet.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

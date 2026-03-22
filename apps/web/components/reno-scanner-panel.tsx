"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SignalEvent } from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";
import { LivePanel } from "./live-panel/live-panel";

type RenoScannerPanelProps = {
  events: SignalEvent[];
};

const AUTHORIZED_BROADCASTIFY_EMBED_URL = process.env.NEXT_PUBLIC_BROADCASTIFY_EMBED_URL?.trim() ?? "";
const DIRECT_BROADCASTIFY_STREAM_URL =
  process.env.NEXT_PUBLIC_RENO_POLICE_STREAM_URL?.trim() ?? "https://broadcastify.cdnstream1.com/7364";
const GATEWAY_API_BASE =
  process.env.NEXT_PUBLIC_GATEWAY_API_URL ?? process.env.GATEWAY_API_URL ?? "http://127.0.0.1:4000";

export function RenoScannerPanel({ events }: RenoScannerPanelProps) {
  void events;

  const [streamEnabled, setStreamEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pipelineActionState, setPipelineActionState] = useState<"idle" | "loading" | "error">("idle");
  const [pipelineMessage, setPipelineMessage] = useState<string>("Dispatch pipeline ready.");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const embedEnabled = AUTHORIZED_BROADCASTIFY_EMBED_URL.length > 0;
  const directStreamEnabled = DIRECT_BROADCASTIFY_STREAM_URL.length > 0;
  const streamAvailable = embedEnabled || directStreamEnabled;
  const canControlAudio = directStreamEnabled && !embedEnabled;

  const radioSrc = useMemo(() => {
    if (embedEnabled) {
      return AUTHORIZED_BROADCASTIFY_EMBED_URL;
    }
    if (directStreamEnabled) {
      return DIRECT_BROADCASTIFY_STREAM_URL;
    }
    return null;
  }, [directStreamEnabled, embedEnabled]);

  useEffect(() => {
    async function syncPipelineStatus() {
      try {
        const response = await fetch(`${GATEWAY_API_BASE}/api/v1/dispatch/streams/status`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          items?: Array<{
            streamId: string;
            state: string;
          }>;
        };
        const active = (payload.items ?? []).some(
          (item) => (item.streamId === "reno-police-primary" || item.streamId === "dispatch-stream-1") && item.state === "running"
        );
        setStreamEnabled(active);
      } catch {
        // Keep defaults if status endpoint is temporarily unavailable.
      }
    }

    void syncPipelineStatus();
  }, []);

  useEffect(() => {
    const player = audioRef.current;
    if (!player) {
      return;
    }

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    player.addEventListener("play", handlePlay);
    player.addEventListener("pause", handlePause);
    return () => {
      player.removeEventListener("play", handlePlay);
      player.removeEventListener("pause", handlePause);
    };
  }, []);

  async function sendPipelineCommand(path: string, body: Record<string, unknown>) {
    setPipelineActionState("loading");
    try {
      const response = await fetch(`${GATEWAY_API_BASE}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Pipeline request failed (${response.status})`);
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const errorMessage = typeof payload.error === "string" ? payload.error : null;
      if (errorMessage) {
        setPipelineActionState("error");
        setPipelineMessage(errorMessage);
        return false;
      }
      setPipelineMessage("Dispatch pipeline updated.");
      setPipelineActionState("idle");
      return true;
    } catch (error) {
      setPipelineActionState("error");
      setPipelineMessage(error instanceof Error ? error.message : "Pipeline action failed.");
      return false;
    }
  }

  async function handleTogglePipeline() {
    if (!DIRECT_BROADCASTIFY_STREAM_URL) {
      setPipelineActionState("error");
      setPipelineMessage("No direct stream URL configured for pipeline ingest.");
      return;
    }

    const nextEnabled = !streamEnabled;
    if (nextEnabled) {
      const started = await sendPipelineCommand("/api/v1/dispatch/streams/start", {
        streamId: "reno-police-primary",
        sourceUrl: DIRECT_BROADCASTIFY_STREAM_URL
      });
      if (started) {
        setStreamEnabled(true);
      }
      return;
    }

    const stopped = await sendPipelineCommand("/api/v1/dispatch/streams/stop", {
      streamId: "reno-police-primary"
    });
    if (stopped) {
      setIsPlaying(false);
      setStreamEnabled(false);
    }
  }

  async function handleTogglePlayback() {
    if (!canControlAudio || !audioRef.current) {
      setPipelineMessage("Browser iframe streams must be controlled in the embedded player.");
      return;
    }

    const player = audioRef.current;
    if (player.paused) {
      try {
        await player.play();
      } catch {
        setPipelineMessage("Browser blocked autoplay. Click play directly on the audio control once.");
      }
      return;
    }
    player.pause();
  }

  return (
    <div className="reno-scanner-panel">
      <div className="reno-scanner-header">
        <div>
          <strong className="reno-scanner-title reno-scanner-title-main">
            Reno Police Emergency and Fire Services
          </strong>
          <p className="reno-scanner-subtitle">
            Real-time transcription and structured dispatch intelligence with rolling summary windows.
          </p>
        </div>
        <div className="reno-scanner-badges">
          <Badge tone="neutral">{streamAvailable ? "Audio source ready" : "Feed pending"}</Badge>
          <Badge tone="neutral">{pipelineActionState === "loading" ? "Syncing..." : "Pipeline control"}</Badge>
        </div>
      </div>

      <div className="reno-scanner-broadcast-bar">
        <div className="reno-scanner-broadcast-title-wrap">
          <span className="reno-scanner-broadcast-label">Stream</span>
          <strong className="reno-scanner-broadcast-title">Reno Police Emergency and Fire Services</strong>
          <span className="reno-scanner-broadcast-copy">
            Audio stream {"->"} interim/final transcript {"->"} structured dispatch intelligence cards.
          </span>
        </div>
        <div className="reno-scanner-control-row">
          <button
            type="button"
            className={`reno-live-button ${streamEnabled ? "is-on" : "is-off"}`}
            onClick={() => void handleTogglePipeline()}
            disabled={pipelineActionState === "loading"}
          >
            <span className="reno-live-button-dot" />
            <span>{streamEnabled ? "Pipeline On" : "Pipeline Off"}</span>
          </button>
          <button
            type="button"
            className={`reno-play-button ${isPlaying ? "is-playing" : "is-idle"}`}
            onClick={() => void handleTogglePlayback()}
            disabled={!streamAvailable}
          >
            {isPlaying ? "Pause Radio" : "Play Radio"}
          </button>
        </div>
      </div>

      <div className="reno-scanner-layout">
        <article className="reno-scanner-audio-card">
          <div className="reno-scanner-audio-head">
            <div>
              <strong>Live dispatch audio</strong>
              <p className="reno-scanner-audio-copy">
                Keep this playing while the backend pipeline emits interim and finalized intelligence updates.
              </p>
            </div>
            <div className="reno-scanner-audio-badges">
              <Badge tone={streamEnabled ? "accent" : "neutral"}>{streamEnabled ? "Pipeline live" : "Pipeline stopped"}</Badge>
              <Badge tone={isPlaying ? "accent" : "neutral"}>{isPlaying ? "Audio playing" : "Audio paused"}</Badge>
            </div>
          </div>

          <div className={`reno-scanner-player-box ${streamEnabled ? "is-live" : "is-dimmed"}`}>
            {embedEnabled && radioSrc ? (
              <iframe
                title="Reno Police Emergency and Fire Services Broadcastify player"
                src={radioSrc}
                className="reno-scanner-player-frame"
                allow="autoplay"
              />
            ) : directStreamEnabled && radioSrc ? (
              <div className="reno-scanner-direct-player">
                <audio ref={audioRef} className="reno-scanner-audio-element" controls preload="none" src={radioSrc}>
                  Your browser does not support the live audio element.
                </audio>
                <div className="reno-scanner-direct-note">Direct stream connected.</div>
              </div>
            ) : (
              <div className="reno-scanner-player-placeholder">
                <strong>Stream source pending</strong>
                <span>Add an approved radio stream URL to activate this stage.</span>
              </div>
            )}
          </div>

          <div className="reno-scanner-actions">
            <a className="reno-scanner-link" href="https://www.broadcastify.com/listen/feed/7364" target="_blank" rel="noreferrer">
              Open source page
            </a>
            <span className="reno-scanner-meta">{pipelineMessage}</span>
          </div>
        </article>

        <LivePanel liveAudioActive={streamEnabled && isPlaying} />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

type CameraMediaViewerProps = {
  title: string;
  src: string;
};

function isImage(src: string): boolean {
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(src);
}

function isHls(src: string): boolean {
  return /\.m3u8(\?|$)/i.test(src);
}

function isDirectVideo(src: string): boolean {
  return /\.(mp4|webm)(\?|$)/i.test(src);
}

export function CameraMediaViewer({ title, src }: CameraMediaViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isHls(src)) {
      return;
    }

    let cancelled = false;
    let hlsInstance: { destroy: () => void } | null = null;

    async function attachHls() {
      const currentVideo = videoRef.current;
      if (!currentVideo) {
        return;
      }

      setStatus("loading");

      if (currentVideo.canPlayType("application/vnd.apple.mpegurl")) {
        currentVideo.src = src;
        return;
      }

      try {
        const module = await import("hls.js");
        const Hls = module.default;

        if (cancelled || !Hls.isSupported()) {
          return;
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true
        });

        hls.loadSource(src);
        hls.attachMedia(currentVideo);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!cancelled) {
            setStatus("ready");
          }
        });
        hls.on(Hls.Events.ERROR, () => {
          if (!cancelled) {
            setStatus("error");
          }
        });

        hlsInstance = hls;
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    }

    const handleLoaded = () => setStatus("ready");
    const handleError = () => setStatus("error");

    video.addEventListener("loadeddata", handleLoaded);
    video.addEventListener("error", handleError);

    void attachHls();

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", handleLoaded);
      video.removeEventListener("error", handleError);
      if (hlsInstance) {
        hlsInstance.destroy();
      }
    };
  }, [src]);

  if (isImage(src)) {
    return <img className="camera-viewer-media" src={src} alt={title} />;
  }

  if (isHls(src) || isDirectVideo(src)) {
    return (
      <div className="camera-video-shell">
        <video
          ref={videoRef}
          className="camera-viewer-media"
          src={isDirectVideo(src) ? src : undefined}
          controls
          muted
          playsInline
          autoPlay
        />
        {status === "loading" ? <div className="camera-video-status">Loading live feed...</div> : null}
        {status === "error" ? (
          <div className="camera-video-status">The live stream could not be played in this browser.</div>
        ) : null}
      </div>
    );
  }

  return (
    <iframe
      className="camera-viewer-media"
      src={src}
      title={title}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

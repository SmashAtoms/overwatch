"use client";

import { useEffect, useRef, useState } from "react";

type CameraMediaViewerProps = {
  title: string;
  src: string;
};

const DEFAULT_IMAGE_REFRESH_MS = 30_000;
const NWS_RENO_WEATHER_CAM_REFRESH_MS = 120_000;
const SKYLINE_VIRGINIA_REFRESH_MS = 3_000;

function isImage(src: string): boolean {
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(src);
}

function isHls(src: string): boolean {
  return /\.m3u8(\?|$)/i.test(src);
}

function isDirectVideo(src: string): boolean {
  return /\.(mp4|webm)(\?|$)/i.test(src);
}

function isYouTubeEmbed(src: string): boolean {
  return /youtube\.com\/embed|youtube-nocookie\.com\/embed/i.test(src);
}

function getImageRefreshInterval(src: string): number {
  if (/embed\.skylinewebcams\.com\/img\/1130\.jpg/i.test(src)) {
    return SKYLINE_VIRGINIA_REFRESH_MS;
  }

  if (/weather\.gov\/images\/rev\/webcamWCAQ\/latestHiRes\.jpg/i.test(src)) {
    return NWS_RENO_WEATHER_CAM_REFRESH_MS;
  }

  return DEFAULT_IMAGE_REFRESH_MS;
}

export function CameraMediaViewer({ title, src }: CameraMediaViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [imageTick, setImageTick] = useState(0);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const isVirginiaSkylineStream = /cam-virginia-city-skyline\/stream\.m3u8/i.test(src);
  const effectiveSrc = fallbackSrc ?? src;

  useEffect(() => {
    setStatus("idle");
    setFallbackSrc(null);
  }, [src]);

  useEffect(() => {
    if (!isImage(effectiveSrc)) {
      return;
    }

    setImageTick(0);
    const intervalId = window.setInterval(() => {
      setImageTick((current) => current + 1);
    }, getImageRefreshInterval(effectiveSrc));

    return () => {
      window.clearInterval(intervalId);
    };
  }, [effectiveSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || (!isHls(effectiveSrc) && !isDirectVideo(effectiveSrc))) {
      return;
    }

    let cancelled = false;
    let hlsInstance: { destroy: () => void } | null = null;

    async function tryPlay(currentVideo: HTMLVideoElement) {
      try {
        await currentVideo.play();
      } catch {
        // Some browsers still block autoplay even when muted.
      }
    }

    async function attachHls() {
      const currentVideo = videoRef.current;
      if (!currentVideo) {
        return;
      }

      setStatus("loading");

      if (isDirectVideo(effectiveSrc)) {
        currentVideo.src = effectiveSrc;
        void tryPlay(currentVideo);
        return;
      }

      if (currentVideo.canPlayType("application/vnd.apple.mpegurl")) {
        currentVideo.src = effectiveSrc;
        void tryPlay(currentVideo);
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

        hls.loadSource(effectiveSrc);
        hls.attachMedia(currentVideo);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!cancelled) {
            setStatus("ready");
            void tryPlay(currentVideo);
          }
        });
        hls.on(Hls.Events.ERROR, () => {
          if (!cancelled) {
            if (isVirginiaSkylineStream) {
              setFallbackSrc("https://embed.skylinewebcams.com/img/1130.jpg");
            }
            setStatus("error");
          }
        });

        hlsInstance = hls;
      } catch {
        if (!cancelled) {
          if (isVirginiaSkylineStream) {
            setFallbackSrc("https://embed.skylinewebcams.com/img/1130.jpg");
          }
          setStatus("error");
        }
      }
    }

    const handleLoaded = () => {
      setStatus("ready");
      const currentVideo = videoRef.current;
      if (currentVideo) {
        void tryPlay(currentVideo);
      }
    };
    const handleError = () => {
      if (isVirginiaSkylineStream) {
        setFallbackSrc("https://embed.skylinewebcams.com/img/1130.jpg");
      }
      setStatus("error");
    };

    video.pause();
    video.removeAttribute("src");
    video.load();
    video.addEventListener("loadeddata", handleLoaded);
    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("error", handleError);

    void attachHls();

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", handleLoaded);
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("error", handleError);
      video.pause();
      if (hlsInstance) {
        hlsInstance.destroy();
      }
    };
  }, [effectiveSrc, isVirginiaSkylineStream]);

  if (isImage(effectiveSrc)) {
    const imageSrc = `${effectiveSrc}${effectiveSrc.includes("?") ? "&" : "?"}t=${imageTick}`;
    return <img className="camera-viewer-media" src={imageSrc} alt={title} />;
  }

  if (isHls(effectiveSrc) || isDirectVideo(effectiveSrc)) {
    return (
      <div className="camera-video-shell">
        <video
          ref={videoRef}
          className="camera-viewer-media"
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
      src={effectiveSrc}
      title={title}
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
      referrerPolicy={isYouTubeEmbed(effectiveSrc) ? "strict-origin-when-cross-origin" : "origin-when-cross-origin"}
    />
  );
}

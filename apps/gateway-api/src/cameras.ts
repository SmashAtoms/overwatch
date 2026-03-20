import { DEFAULT_REGION, type CameraSource } from "@signalstack/contracts";
import { cameras as fallbackCameras } from "./data.js";

const RENO_CAMERA_RADIUS_MILES = 50;
const ALLOWED_HIGHWAY_PATTERNS = [/\bI-?80\b/i, /\bUS-?395\b/i, /\b395\b/i];

type Nevada511CameraView = {
  Id: number;
  Url: string | null;
  Status: string;
  Description: string | null;
  VideoUrl: string | null;
};

type Nevada511Camera = {
  Id: number;
  Source: string;
  SourceId: string;
  Roadway: string | null;
  Direction: string | null;
  Latitude: number;
  Longitude: number;
  Location: string | null;
  SortOrder: number;
  Views: Nevada511CameraView[];
};

const CACHE_TTL_MS = 60_000;

let cameraCache:
  | {
      expiresAt: number;
      data: CameraSource[];
    }
  | undefined;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function isDirectMediaUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  return /\.(png|jpe?g|gif|webp|mp4|webm|m3u8)(\?|$)/i.test(url);
}

function milesBetween(
  left: { lat: number; lon: number },
  right: { lat: number; lon: number }
): number {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(right.lat - left.lat);
  const dLon = toRadians(right.lon - left.lon);
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

function inDefaultRegion(camera: Nevada511Camera): boolean {
  const [minLon, minLat, maxLon, maxLat] = DEFAULT_REGION.bbox;
  return (
    camera.Longitude >= minLon &&
    camera.Longitude <= maxLon &&
    camera.Latitude >= minLat &&
    camera.Latitude <= maxLat
  );
}

function inRenoCameraRadius(camera: Nevada511Camera): boolean {
  const distanceMiles = milesBetween(
    { lat: DEFAULT_REGION.center.lat, lon: DEFAULT_REGION.center.lon },
    { lat: camera.Latitude, lon: camera.Longitude }
  );

  return distanceMiles <= RENO_CAMERA_RADIUS_MILES;
}

function matchesAllowedHighway(roadway: string | null): boolean {
  if (!roadway) {
    return false;
  }

  return ALLOWED_HIGHWAY_PATTERNS.some((pattern) => pattern.test(roadway));
}

function isAllowedRenoCamera(camera: Nevada511Camera): boolean {
  return inDefaultRegion(camera) && inRenoCameraRadius(camera) && matchesAllowedHighway(camera.Roadway);
}

function normalizeRoadway(roadway: string | null): string | null {
  if (!roadway) {
    return null;
  }

  return roadway
    .replace(/\bI(\d+)/gi, "I-$1")
    .replace(/\bUS(\d+)/gi, "US-$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCameraName(camera: Nevada511Camera): string {
  const roadway = normalizeRoadway(camera.Roadway);
  const direction = camera.Direction && camera.Direction !== "Unknown" ? camera.Direction : null;
  const location = camera.Location && camera.Location !== "Unknown" ? camera.Location.trim() : null;

  if (location && roadway && location.toLowerCase().includes(roadway.toLowerCase())) {
    return location;
  }

  const parts = [roadway, direction, location].filter(
    (value, index, array): value is string => Boolean(value) && array.indexOf(value) === index
  );

  return parts.join(" ") || `Nevada 511 Camera ${camera.Id}`;
}

function toCameraSource(camera: Nevada511Camera): CameraSource {
  const primaryView = camera.Views.find((view) => view.Status === "Enabled") ?? camera.Views[0];
  const previewUrl = primaryView?.VideoUrl ?? (isDirectMediaUrl(primaryView?.Url) ? primaryView?.Url : null);
  const embedMode = previewUrl ? "embed" : "link_only";

  return {
    id: `nv511-${camera.Id}`,
    name: cleanCameraName(camera),
    provider: camera.Source || "Nevada 511",
    point: {
      lat: camera.Latitude,
      lon: camera.Longitude
    },
    embedMode,
    targetUrl: primaryView?.Url ?? "https://www.nvroads.com/",
    previewUrl,
    status: primaryView?.Status === "Enabled" ? "active" : "offline"
  };
}

export async function loadCameraSources(): Promise<CameraSource[]> {
  if (cameraCache && cameraCache.expiresAt > Date.now()) {
    return cameraCache.data;
  }

  const apiKey = process.env.NEVADA_511_API_KEY;

  if (!apiKey) {
    return fallbackCameras;
  }

  try {
    const response = await fetch(
      `https://www.nvroads.com/api/v2/get/cameras?key=${encodeURIComponent(apiKey)}&format=json`,
      {
        headers: {
          accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Nevada 511 camera request failed: ${response.status}`);
    }

    const payload = (await response.json()) as Nevada511Camera[];
    const regionCameras = payload
      .filter(isAllowedRenoCamera)
      .map(toCameraSource)
      .sort((left, right) => left.name.localeCompare(right.name));

    const data = regionCameras.length > 0 ? regionCameras : fallbackCameras;

    cameraCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data
    };

    return data;
  } catch {
    return fallbackCameras;
  }
}

import { DEFAULT_REGION, type CameraSource } from "@signalstack/contracts";
import { cameras as fallbackCameras } from "./data.js";

const RENO_CAMERA_RADIUS_MILES = 50;

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
const CUSTOM_CAMERA_ID_PREFIX = "cam-";

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

function isAllowedRenoCamera(camera: Nevada511Camera): boolean {
  return inDefaultRegion(camera) && inRenoCameraRadius(camera);
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

function normalizeComparable(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isMeaningfulLabel(value: string | null): value is string {
  return Boolean(value && value !== "Unknown" && value !== "N/A");
}

function cleanCameraName(camera: Nevada511Camera): string {
  const roadway = normalizeRoadway(camera.Roadway);
  const direction = camera.Direction && camera.Direction !== "Unknown" ? camera.Direction : null;
  const location = isMeaningfulLabel(camera.Location) ? normalizeRoadway(camera.Location.trim()) : null;

  if (location && roadway && normalizeComparable(location).includes(normalizeComparable(roadway))) {
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

  const customCameras = fallbackCameras.filter((camera) => camera.id.startsWith(CUSTOM_CAMERA_ID_PREFIX));
  const fallbackNevadaCameras = fallbackCameras.filter(
    (camera) => !camera.id.startsWith(CUSTOM_CAMERA_ID_PREFIX)
  );

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
    const dedupedCameras = new Map<string, CameraSource>();
    const regionCameras = payload
      .filter(isAllowedRenoCamera)
      .map(toCameraSource)
      .sort((left, right) => left.name.localeCompare(right.name));

    regionCameras.forEach((camera) => {
      const dedupeKey = `${camera.name}:${camera.point.lat.toFixed(4)}:${camera.point.lon.toFixed(4)}`;
      if (!dedupedCameras.has(dedupeKey)) {
        dedupedCameras.set(dedupeKey, camera);
      }
    });

    const mergedCameras = dedupedCameras.size > 0 ? Array.from(dedupedCameras.values()) : fallbackNevadaCameras;
    const data = [...customCameras, ...mergedCameras];

    cameraCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data
    };

    return data;
  } catch {
    return fallbackCameras;
  }
}

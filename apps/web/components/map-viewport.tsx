"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CameraSource,
  InformationStack,
  RegionConfig,
  SignalEvent,
  SourceKind
} from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";
import type { Layer, LayerGroup, Map as LeafletMap } from "leaflet";
import { CameraMediaViewer } from "./camera-media-viewer";
import type { FlightSubscriptionRecord } from "../lib/api";

type MapViewportProps = {
  region: RegionConfig;
  events: SignalEvent[];
  stacks: InformationStack[];
  cameras: CameraSource[];
  initialFlightSubscriptions: FlightSubscriptionRecord[];
};

type AircraftRefreshState = {
  status: "idle" | "submitting" | "success" | "error";
  message: string | null;
  fetchedAt: string | null;
};

type AircraftTrackPoint = {
  lat: number;
  lon: number;
  altM: number | null;
  ts: string;
};

type AircraftTrackHistory = Record<string, AircraftTrackPoint[]>;

type SelectedOverlay =
  | { type: "event"; id: string }
  | { type: "stack"; id: string }
  | { type: "camera"; id: string }
  | null;

type MapMode = "google" | "leaflet";
type CameraScope = "rno_airport" | "reno_corridor";
type MapDirection = "north" | "south" | "east" | "west";
type MapZoom = "in" | "out";

const NOAA_DOPPLER_WMS_URL = "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows";
const NOAA_DOPPLER_LAYER = "conus_bref_qcd";
const OPENWEATHER_CLOUDS_URL = "https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid={apiKey}";
const OPENWEATHER_PRECIPITATION_URL =
  "https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid={apiKey}";
const AIRCRAFT_SYMBOL_PATH =
  "M 0 -18 L 4 -6 L 16 -4 L 16 2 L 4 2 L 2 18 L -2 18 L -4 2 L -16 2 L -16 -4 L -4 -6 Z";

const MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0c1a2c" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#d9e7ff" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0c1a2c" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#162944" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#21486b" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#091524" }] }
];

const SOURCE_COLORS: Record<SourceKind, string> = {
  aircraft: "#59c7ff",
  atc: "#7de2d1",
  scanner: "#ff7b9c",
  weather: "#ffcf6e",
  camera: "#cfa7ff"
};

const SOURCE_LABELS: Record<SourceKind, string> = {
  aircraft: "Aircraft",
  atc: "ATC",
  scanner: "Scanner",
  weather: "Weather",
  camera: "Cameras"
};

const FILTERABLE_SOURCE_KINDS: SourceKind[] = ["aircraft", "atc", "scanner", "camera"];
const AIRCRAFT_REFRESH_INTERVAL_MS = 15_000;
const MAX_TRACK_POINTS = 10;
const DEFAULT_CAMERA_ID = "nv511-4986";

declare global {
  interface Window {
    __renoSignalStackGoogleMapsPromise?: Promise<typeof google.maps>;
  }
}

function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only load in the browser."));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (window.__renoSignalStackGoogleMapsPromise) {
    return window.__renoSignalStackGoogleMapsPromise;
  }

  window.__renoSignalStackGoogleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-google-maps-loader='true']");

    if (existing) {
      existing.addEventListener("load", () => resolve(window.google.maps), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Maps.")), {
        once: true
      });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = "true";
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error("Failed to load Google Maps."));
    document.head.appendChild(script);
  });

  return window.__renoSignalStackGoogleMapsPromise;
}

function createAircraftTrail(event: SignalEvent): Array<{ lat: number; lng: number }> {
  const headingDeg = typeof event.rawPayload?.headingDeg === "number" ? event.rawPayload.headingDeg : 0;
  const radians = ((headingDeg - 180) * Math.PI) / 180;
  const distance = 0.08;

  return [
    {
      lat: event.point.lat - Math.sin(radians) * distance,
      lng: event.point.lon - Math.cos(radians) * distance
    },
    { lat: event.point.lat, lng: event.point.lon }
  ];
}

function buildAircraftTrackHistory(events: SignalEvent[]): AircraftTrackHistory {
  return events.reduce<AircraftTrackHistory>((acc, event) => {
    if (event.sourceType !== "aircraft") {
      return acc;
    }

    acc[event.id] = [
      {
        lat: event.point.lat,
        lon: event.point.lon,
        altM: event.point.altM ?? null,
        ts: event.occurredAt
      }
    ];
    return acc;
  }, {});
}

function mergeAircraftTrackHistory(
  current: AircraftTrackHistory,
  aircraftEvents: SignalEvent[]
): AircraftTrackHistory {
  const next: AircraftTrackHistory = {};

  aircraftEvents.forEach((event) => {
    const previousPoints = current[event.id] ?? [];
    const nextPoint: AircraftTrackPoint = {
      lat: event.point.lat,
      lon: event.point.lon,
      altM: event.point.altM ?? null,
      ts: event.occurredAt
    };
    const alreadyTracked = previousPoints.some(
      (point) =>
        point.ts === nextPoint.ts &&
        point.lat === nextPoint.lat &&
        point.lon === nextPoint.lon
    );
    const mergedPoints = alreadyTracked ? previousPoints : [...previousPoints, nextPoint];
    next[event.id] = mergedPoints.slice(-MAX_TRACK_POINTS);
  });

  return next;
}

function getAircraftHeading(event: SignalEvent): number {
  return typeof event.rawPayload?.headingDeg === "number" ? event.rawPayload.headingDeg : 0;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatEventMeta(item: SignalEvent): string {
  return `${item.sourceType.toUpperCase()} | ${Math.round(item.confidence * 100)}% confidence`;
}

function formatStackMeta(item: InformationStack): string {
  return `${item.sources.join(", ")} | ${Math.round(item.confidence * 100)}% confidence`;
}

function createRegionBounds(region: RegionConfig): [[number, number], [number, number]] {
  return [
    [region.bbox[1], region.bbox[0]],
    [region.bbox[3], region.bbox[2]]
  ];
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function milesBetween(left: { lat: number; lon: number }, right: { lat: number; lon: number }): number {
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

function isCorridorCamera(camera: CameraSource): boolean {
  return /\bI-?80\b|\bUS-?395\b|\b395\b/i.test(camera.name);
}

function isAirportCamera(camera: CameraSource, krnoPoint: { lat: number; lon: number }): boolean {
  const distanceMiles = milesBetween(krnoPoint, camera.point);
  return (
    distanceMiles <= 3.5 ||
    /\bairport\b|\bplumb\b|\bmill\b|\bvillanova\b|\bkietzke\b/i.test(camera.name)
  );
}

function getAircraftDisplayIdentifier(event: SignalEvent | null): string | null {
  if (!event || event.sourceType !== "aircraft") {
    return null;
  }

  const registrationEntity = event.entities?.find(
    (entity) => entity.kind === "registration" || entity.kind === "tail_number"
  )?.value;
  if (registrationEntity?.trim()) {
    return registrationEntity.trim().toUpperCase();
  }

  const rawRegistration = event.rawPayload?.registration;
  if (typeof rawRegistration === "string" && rawRegistration.trim()) {
    return rawRegistration.trim().toUpperCase();
  }

  const rawTailNumber = event.rawPayload?.tailNumber;
  if (typeof rawTailNumber === "string" && rawTailNumber.trim()) {
    return rawTailNumber.trim().toUpperCase();
  }

  return getFlightSubscriptionIdentifier(event);
}

function hasAircraftTailNumber(event: SignalEvent | null): boolean {
  if (!event || event.sourceType !== "aircraft") {
    return false;
  }

  const registrationEntity = event.entities?.some(
    (entity) => entity.kind === "registration" || entity.kind === "tail_number"
  );
  const rawRegistration = typeof event.rawPayload?.registration === "string" && event.rawPayload.registration.trim();
  const rawTailNumber = typeof event.rawPayload?.tailNumber === "string" && event.rawPayload.tailNumber.trim();

  return Boolean(registrationEntity || rawRegistration || rawTailNumber);
}

function getFlightSubscriptionIdentifier(event: SignalEvent | null): string | null {
  if (!event || event.sourceType !== "aircraft") {
    return null;
  }

  const rawCallsign = event.rawPayload?.callsign;
  if (typeof rawCallsign === "string" && rawCallsign.trim()) {
    return rawCallsign.trim().toUpperCase();
  }

  const entityCallsign = event.entities?.find((entity) => entity.kind === "callsign")?.value;
  return entityCallsign ? entityCallsign.trim().toUpperCase() : null;
}

function createLeafletAircraftIcon(
  event: SignalEvent,
  displayIdentifier: string,
  isSubscribedFlight: boolean
) {
  const headingDeg = getAircraftHeading(event);
  const bodyColor = isSubscribedFlight ? "#7de2d1" : SOURCE_COLORS.aircraft;
  const outlineColor = isSubscribedFlight ? "#ffcf6e" : "#07111f";
  const safeIdentifier = escapeHtml(displayIdentifier);
  const safeSummary = escapeHtml(event.summary);

  return {
    className: "aircraft-marker-icon",
    html: `
      <div style="display:flex; flex-direction:column; align-items:center; transform:translate(-50%, -50%);">
        <div style="padding:2px 8px; border-radius:999px; background:rgba(6, 20, 38, 0.92); border:1px solid ${outlineColor}; color:#eef6ff; font-size:11px; font-weight:700; letter-spacing:0.04em; white-space:nowrap; box-shadow:0 8px 18px rgba(0,0,0,0.35);">
          ${safeIdentifier}
        </div>
        <div title="${safeSummary}" style="margin-top:4px; width:34px; height:34px; display:grid; place-items:center; filter:drop-shadow(0 6px 10px rgba(0,0,0,0.35));">
          <svg width="34" height="34" viewBox="-20 -20 40 40" style="transform:rotate(${headingDeg}deg); overflow:visible;" aria-hidden="true">
            <path d="${AIRCRAFT_SYMBOL_PATH}" fill="${bodyColor}" stroke="${outlineColor}" stroke-width="${isSubscribedFlight ? 2.6 : 2.2}" stroke-linejoin="round" />
          </svg>
        </div>
      </div>
    `,
    iconSize: [90, 54] as [number, number],
    iconAnchor: [45, 42] as [number, number]
  };
}

export function MapViewport({
  region,
  events,
  stacks,
  cameras,
  initialFlightSubscriptions
}: MapViewportProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const cameraViewerCardRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const leafletMapRef = useRef<LeafletMap | null>(null);
  const leafletOverlayGroupRef = useRef<LayerGroup | null>(null);
  const leafletWeatherGroupRef = useRef<LayerGroup | null>(null);
  const persistedLeafletViewRef = useRef<{ center: { lat: number; lon: number }; zoom: number } | null>(null);
  const persistedGoogleViewRef = useRef<{ center: { lat: number; lon: number }; zoom: number } | null>(null);
  const initialCamera = cameras.find((camera) => camera.id === DEFAULT_CAMERA_ID) ?? cameras[0] ?? null;
  const [selectedOverlay, setSelectedOverlay] = useState<SelectedOverlay>(() => {
    return initialCamera ? { type: "camera", id: initialCamera.id } : null;
  });
  const [liveEvents, setLiveEvents] = useState<SignalEvent[]>(events);
  const [aircraftTracks, setAircraftTracks] = useState<AircraftTrackHistory>(() =>
    buildAircraftTrackHistory(events)
  );
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">("loading");
  const [mapMode, setMapMode] = useState<MapMode>("leaflet");
  const [cameraScope, setCameraScope] = useState<CameraScope>("rno_airport");
  const [activeViewerCameraId, setActiveViewerCameraId] = useState<string | null>(() => initialCamera?.id ?? null);
  const [isCameraPopupOpen, setIsCameraPopupOpen] = useState(false);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(true);
  const [flightSubscriptions, setFlightSubscriptions] =
    useState<FlightSubscriptionRecord[]>(initialFlightSubscriptions);
  const [flightActionState, setFlightActionState] = useState<{
    status: "idle" | "submitting" | "success" | "error";
    message: string | null;
  }>({
    status: "idle",
    message: null
  });
  const [aircraftRefreshState, setAircraftRefreshState] = useState<AircraftRefreshState>(() => ({
    status: "idle",
    message: null,
    fetchedAt: events.find((event) => event.sourceType === "aircraft")?.ingestedAt ?? null
  }));
  const [visibleKinds, setVisibleKinds] = useState<Record<SourceKind, boolean>>({
    aircraft: true,
    atc: true,
    scanner: true,
    weather: true,
    camera: true
  });

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const openWeatherMapApiKey = process.env.NEXT_PUBLIC_OPENWEATHERMAP_API_KEY;
  const clientGatewayApiUrl =
    process.env.NEXT_PUBLIC_GATEWAY_API_URL ?? "http://localhost:4000";
  const forceLeafletBase = true;

  function isSourceVisible(source: SourceKind) {
    if (source === "weather") {
      return showWeatherOverlay;
    }

    return visibleKinds[source];
  }

  const filteredEvents = useMemo(
    () => liveEvents.filter((event) => isSourceVisible(event.sourceType) && event.sourceType !== "camera"),
    [liveEvents, showWeatherOverlay, visibleKinds]
  );
  const mapRenderableEvents = useMemo(
    () => filteredEvents.filter((event) => event.sourceType !== "weather"),
    [filteredEvents]
  );
  const krnoPoint = useMemo(() => {
    const krnoViewpoint = region.savedViewpoints.find((viewpoint) => viewpoint.id === "krno");
    return krnoViewpoint ? { lat: krnoViewpoint.point.lat, lon: krnoViewpoint.point.lon } : { lat: 39.4991, lon: -119.7681 };
  }, [region.savedViewpoints]);
  const scopedCameras = useMemo(() => {
    const activeCameras = cameras.filter((camera) => camera.status === "active");

    if (cameraScope === "reno_corridor") {
      return activeCameras.filter(isCorridorCamera).sort((left, right) => {
        const embedScore = Number(right.embedMode === "embed") - Number(left.embedMode === "embed");
        return embedScore !== 0 ? embedScore : left.name.localeCompare(right.name);
      });
    }

    return activeCameras
      .filter((camera) => isAirportCamera(camera, krnoPoint))
      .sort((left, right) => {
        const embedScore = Number(right.embedMode === "embed") - Number(left.embedMode === "embed");
        if (embedScore !== 0) {
          return embedScore;
        }

        return milesBetween(krnoPoint, left.point) - milesBetween(krnoPoint, right.point);
      })
      .slice(0, 18);
  }, [cameraScope, cameras, krnoPoint]);
  const filteredCameras = useMemo(
    () => (visibleKinds.camera ? scopedCameras : []),
    [scopedCameras, visibleKinds.camera]
  );
  const filteredStacks = useMemo(
    () => stacks.filter((stack) => stack.sources.some((source) => isSourceVisible(source))),
    [showWeatherOverlay, stacks, visibleKinds]
  );
  const defaultSelectedEvent = useMemo(
    () => mapRenderableEvents.find((event) => event.sourceType === "aircraft") ?? filteredEvents[0] ?? null,
    [filteredEvents, mapRenderableEvents]
  );

  const selectedEvent =
    selectedOverlay?.type === "event"
      ? filteredEvents.find((event) => event.id === selectedOverlay.id) ?? null
      : null;
  const selectedStack =
    selectedOverlay?.type === "stack"
      ? filteredStacks.find((stack) => stack.id === selectedOverlay.id) ?? null
      : null;
  const selectedCamera =
    selectedOverlay?.type === "camera"
      ? filteredCameras.find((camera) => camera.id === selectedOverlay.id) ?? null
      : null;
  const viewerCamera =
    filteredCameras.find((camera) => camera.id === activeViewerCameraId) ??
    selectedCamera ??
    filteredCameras[0] ??
    null;
  const selectedAircraftDisplayId = getAircraftDisplayIdentifier(selectedEvent);
  const selectedFlightIdentifier = getFlightSubscriptionIdentifier(selectedEvent);
  const selectedAircraftHasTailNumber = hasAircraftTailNumber(selectedEvent);
  const subscribedFlightNumbers = useMemo(
    () => new Set(flightSubscriptions.map((item) => item.flightNumber.toUpperCase())),
    [flightSubscriptions]
  );
  const isSelectedFlightSubscribed = selectedFlightIdentifier
    ? subscribedFlightNumbers.has(selectedFlightIdentifier)
    : false;
  const viewerHasEmbeddedFeed = Boolean(
    viewerCamera && viewerCamera.embedMode === "embed" && viewerCamera.previewUrl
  );
  const cameraScopeLabel =
    cameraScope === "rno_airport" ? "RNO airport perimeter live feeds" : "Reno corridor live feeds";
  const orderedCameras = useMemo(() => {
    if (!viewerCamera) {
      return filteredCameras;
    }

    return [
      viewerCamera,
      ...filteredCameras.filter((camera) => camera.id !== viewerCamera.id)
    ];
  }, [filteredCameras, viewerCamera]);
  const hasEmbeddedCameraFeed = filteredCameras.some((camera) => camera.embedMode === "embed" && camera.previewUrl);

  const sourceCounts = useMemo(() => {
    const counts = filteredEvents.reduce<Record<string, number>>((acc, event) => {
      acc[event.sourceType] = (acc[event.sourceType] ?? 0) + 1;
      return acc;
    }, {});
    counts.weather = showWeatherOverlay ? 1 : 0;
    counts.camera = filteredCameras.length;
    return counts;
  }, [filteredEvents, filteredCameras, showWeatherOverlay]);
  const liveAircraftCount = filteredEvents.filter((event) => event.sourceType === "aircraft").length;
  const selectedAircraftTrack =
    selectedEvent?.sourceType === "aircraft" ? aircraftTracks[selectedEvent.id] ?? [] : [];

  useEffect(() => {
    setLiveEvents(events);
    setAircraftTracks(buildAircraftTrackHistory(events));
    setAircraftRefreshState((current) => ({
      ...current,
      fetchedAt: events.find((event) => event.sourceType === "aircraft")?.ingestedAt ?? current.fetchedAt
    }));
  }, [events]);

  useEffect(() => {
    setAircraftTracks((current) =>
      mergeAircraftTrackHistory(
        current,
        liveEvents.filter((event) => event.sourceType === "aircraft")
      )
    );
  }, [liveEvents]);

  useEffect(() => {
    if (selectedOverlay?.type === "event") {
      const selectedEventStillVisible = filteredEvents.some((event) => event.id === selectedOverlay.id);
      if (!selectedEventStillVisible) {
        if (defaultSelectedEvent) {
          setSelectedOverlay({ type: "event", id: defaultSelectedEvent.id });
        } else if (filteredCameras[0]) {
          setSelectedOverlay({ type: "camera", id: filteredCameras[0].id });
        } else {
          setSelectedOverlay(null);
        }
      }
      return;
    }

    if (filteredCameras.length === 0) {
      if (selectedOverlay?.type === "camera") {
        setSelectedOverlay(null);
      }
      return;
    }

    if (!selectedOverlay) {
      if (defaultSelectedEvent) {
        setSelectedOverlay({ type: "event", id: defaultSelectedEvent.id });
      } else {
        setSelectedOverlay({ type: "camera", id: filteredCameras[0].id });
      }
      return;
    }

    if (
      selectedOverlay.type === "camera" &&
      !filteredCameras.some((camera) => camera.id === selectedOverlay.id)
    ) {
      if (defaultSelectedEvent) {
        setSelectedOverlay({ type: "event", id: defaultSelectedEvent.id });
      } else {
        setSelectedOverlay({ type: "camera", id: filteredCameras[0].id });
      }
    }
  }, [defaultSelectedEvent, filteredCameras, filteredEvents, selectedOverlay]);

  useEffect(() => {
    if (filteredCameras.length === 0) {
      setActiveViewerCameraId(null);
      return;
    }

    setActiveViewerCameraId((current) => {
      if (current && filteredCameras.some((camera) => camera.id === current)) {
        return current;
      }

      if (
        selectedOverlay?.type === "camera" &&
        filteredCameras.some((camera) => camera.id === selectedOverlay.id)
      ) {
        return selectedOverlay.id;
      }

      return current ?? filteredCameras[0]?.id ?? null;
    });
  }, [filteredCameras, selectedOverlay]);

  useEffect(() => {
    if (!isCameraPopupOpen || typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCameraPopupOpen]);

  useEffect(() => {
    if (!mapNodeRef.current || leafletMapRef.current) {
      return;
    }

    let cancelled = false;

    async function initLeafletMap() {
      try {
        const leafletModule = await import("leaflet");
        const L = leafletModule.default;

        if (!mapNodeRef.current || cancelled) {
          return;
        }

        setMapMode("leaflet");
        mapNodeRef.current.innerHTML = "";
        const map = L.map(mapNodeRef.current, {
          zoomControl: false,
          attributionControl: true
        });

        leafletMapRef.current = map;
        leafletOverlayGroupRef.current = L.layerGroup().addTo(map);
        leafletWeatherGroupRef.current = L.layerGroup().addTo(map);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors"
        }).addTo(map);

        if (persistedLeafletViewRef.current) {
          map.setView(
            [persistedLeafletViewRef.current.center.lat, persistedLeafletViewRef.current.center.lon],
            persistedLeafletViewRef.current.zoom,
            { animate: false }
          );
        } else {
          map.fitBounds(createRegionBounds(region), {
            padding: [24, 24]
          });
        }

        map.on("moveend zoomend", () => {
          const center = map.getCenter();
          persistedLeafletViewRef.current = {
            center: {
              lat: center.lat,
              lon: center.lng
            },
            zoom: map.getZoom()
          };
        });

        if (!cancelled) {
          setMapState("ready");
        }
      } catch (_error) {
        if (!cancelled) {
          setMapState("error");
        }
      }
    }

    if (mapState !== "ready") {
      setMapState("loading");
    }
    void initLeafletMap();

    return () => {
      cancelled = true;
      leafletOverlayGroupRef.current?.clearLayers();
      leafletWeatherGroupRef.current?.clearLayers();
      leafletOverlayGroupRef.current = null;
      leafletWeatherGroupRef.current = null;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [mapState, region]);

  useEffect(() => {
    const map = leafletMapRef.current;
    const weatherGroup = leafletWeatherGroupRef.current;
    if (!map || !weatherGroup) {
      return;
    }

    let cancelled = false;

    async function syncWeatherLayers() {
      const leafletModule = await import("leaflet");
      const L = leafletModule.default;

      if (cancelled || !leafletWeatherGroupRef.current) {
        return;
      }

      const weatherGroup = leafletWeatherGroupRef.current;
      weatherGroup.clearLayers();

      if (!showWeatherOverlay) {
        return;
      }

      const radarLayer = L.tileLayer.wms(NOAA_DOPPLER_WMS_URL, {
        layers: NOAA_DOPPLER_LAYER,
        format: "image/png",
        transparent: true,
        opacity: 0.66,
        version: "1.3.0",
        attribution: "NOAA/NCEP MRMS Composite Radar"
      });
      weatherGroup.addLayer(radarLayer);

      if (openWeatherMapApiKey) {
        const precipitationLayer = L.tileLayer(
          OPENWEATHER_PRECIPITATION_URL.replace("{apiKey}", openWeatherMapApiKey),
          {
            opacity: 0.52,
            attribution: "OpenWeather precipitation layer"
          }
        );

        const cloudsLayer = L.tileLayer(
          OPENWEATHER_CLOUDS_URL.replace("{apiKey}", openWeatherMapApiKey),
          {
            opacity: 0.36,
            attribution: "OpenWeather cloud layer"
          }
        );

        weatherGroup.addLayer(precipitationLayer);
        weatherGroup.addLayer(cloudsLayer);
      }
    }

    void syncWeatherLayers();

    return () => {
      cancelled = true;
    };
  }, [mapState, openWeatherMapApiKey, showWeatherOverlay]);

  useEffect(() => {
    const map = leafletMapRef.current;
    const overlayGroup = leafletOverlayGroupRef.current;
    if (!map || !overlayGroup) {
      return;
    }

    let cancelled = false;

    async function syncOverlayLayers() {
      const leafletModule = await import("leaflet");
      const L = leafletModule.default;

      if (cancelled || !leafletOverlayGroupRef.current) {
        return;
      }

      const overlayGroup = leafletOverlayGroupRef.current;
      overlayGroup.clearLayers();

      mapRenderableEvents.forEach((event) => {
        const eventFlightIdentifier = getFlightSubscriptionIdentifier(event);
        const aircraftDisplayId = getAircraftDisplayIdentifier(event);
        const isSubscribedFlight =
          eventFlightIdentifier ? subscribedFlightNumbers.has(eventFlightIdentifier) : false;
        const marker =
          event.sourceType === "aircraft" && aircraftDisplayId
            ? L.marker([event.point.lat, event.point.lon], {
                icon: L.divIcon(createLeafletAircraftIcon(event, aircraftDisplayId, isSubscribedFlight))
              }).bindTooltip(
                isSubscribedFlight
                  ? `${aircraftDisplayId} | ${event.summary} | webhook active`
                  : `${aircraftDisplayId} | ${event.summary}`
              )
            : L.circleMarker([event.point.lat, event.point.lon], {
                radius: 6,
                fillColor: SOURCE_COLORS[event.sourceType],
                color: "#07111f",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.95
              }).bindTooltip(event.summary);

        marker.on("click", () => {
          setSelectedOverlay({ type: "event", id: event.id });
        });
        overlayGroup.addLayer(marker);

        if (event.sourceType === "aircraft") {
          const trajectoryPath = (aircraftTracks[event.id] ?? []).map(
            (point) => [point.lat, point.lon] as [number, number]
          );
          const trail = L.polyline(
            trajectoryPath.length > 1
              ? trajectoryPath
              : createAircraftTrail(event).map((point) => [point.lat, point.lng] as [number, number]),
            {
              color: isSubscribedFlight ? "#ffcf6e" : SOURCE_COLORS.aircraft,
              weight: isSubscribedFlight ? 4 : 3,
              opacity: 0.9
            }
          );
          overlayGroup.addLayer(trail);
        }
      });

      filteredStacks.forEach((stack) => {
        const marker = L.circleMarker([stack.centroid.lat, stack.centroid.lon], {
          radius: 10,
          fillColor: "#ffffff",
          color: stack.policy.restricted ? SOURCE_COLORS.scanner : SOURCE_COLORS.atc,
          weight: 3,
          opacity: 1,
          fillOpacity: 0.75
        }).bindTooltip(stack.title);

        marker.on("click", () => {
          setSelectedOverlay({ type: "stack", id: stack.id });
        });

        overlayGroup.addLayer(marker);
      });

      filteredCameras.forEach((camera) => {
        const marker = L.circleMarker([camera.point.lat, camera.point.lon], {
          radius: 8,
          fillColor: SOURCE_COLORS.camera,
          color: "#07111f",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.95
        }).bindTooltip(camera.name);

        marker.on("click", () => {
          viewCameraOnDashboard(camera);
        });

        overlayGroup.addLayer(marker);
      });
    }

    void syncOverlayLayers();

    return () => {
      cancelled = true;
    };
  }, [aircraftTracks, filteredCameras, filteredStacks, mapRenderableEvents, mapState, subscribedFlightNumbers]);

  async function subscribeSelectedFlight() {
    if (!selectedFlightIdentifier) {
      setFlightActionState({
        status: "error",
        message: "No flight number or callsign is available for this aircraft."
      });
      return;
    }

    setFlightActionState({
      status: "submitting",
      message: `Creating webhook for ${selectedFlightIdentifier}...`
    });

    try {
      const response = await fetch(
        `${clientGatewayApiUrl}/api/v1/integrations/aerodatabox/subscriptions/flight-by-number/${encodeURIComponent(selectedFlightIdentifier)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            maxDeliveryRetries: 0
          })
        }
      );

      const payload = (await response.json()) as
        | { ok: true; record: FlightSubscriptionRecord }
        | { ok: false; error: string };

      if (!response.ok || !payload.ok) {
        const errorMessage = "error" in payload ? payload.error : "Subscription failed.";
        throw new Error(errorMessage);
      }

      setFlightSubscriptions((current) => {
        const next = current.filter(
          (item) => item.flightNumber !== payload.record.flightNumber
        );
        return [payload.record, ...next];
      });
      setFlightActionState({
        status: "success",
        message: `Webhook active for ${payload.record.flightNumber}.`
      });
    } catch (error) {
      setFlightActionState({
        status: "error",
        message: error instanceof Error ? error.message : "Webhook request failed."
      });
    }
  }

  function toggleKind(kind: SourceKind) {
    setVisibleKinds((current) => ({
      ...current,
      [kind]: !current[kind]
    }));
  }

  function setAllKinds(nextValue: boolean) {
    setVisibleKinds((current) => ({
      ...current,
      aircraft: nextValue,
      atc: nextValue,
      scanner: nextValue,
      camera: nextValue
    }));
  }

  function fitRegion() {
    if (mapMode === "google" && googleMapRef.current) {
      const maps = window.google.maps;
      const bounds = new maps.LatLngBounds(
        { lat: region.bbox[1], lng: region.bbox[0] },
        { lat: region.bbox[3], lng: region.bbox[2] }
      );
      googleMapRef.current.fitBounds(bounds, 32);
      return;
    }

    if (leafletMapRef.current) {
      leafletMapRef.current.fitBounds(createRegionBounds(region), {
        padding: [24, 24]
      });
    }
  }

  function focusOnPoints(points: Array<{ lat: number; lon: number }>) {
    if (points.length === 0) {
      return;
    }

    if (mapMode === "google" && googleMapRef.current && window.google?.maps) {
      const bounds = new window.google.maps.LatLngBounds();
      points.forEach((point) => {
        bounds.extend({
          lat: point.lat,
          lng: point.lon
        });
      });
      googleMapRef.current.fitBounds(bounds, 48);
      return;
    }

    if (leafletMapRef.current) {
      leafletMapRef.current.fitBounds(
        points.map((point) => [point.lat, point.lon] as [number, number]),
        {
          padding: [48, 48]
        }
      );
    }
  }

  function focusOnPoint(point: { lat: number; lon: number }, zoom = 12) {
    if (mapMode === "google" && googleMapRef.current) {
      googleMapRef.current.setCenter({
        lat: point.lat,
        lng: point.lon
      });
      googleMapRef.current.setZoom(zoom);
      return;
    }

    if (leafletMapRef.current) {
      leafletMapRef.current.setView([point.lat, point.lon], zoom);
    }
  }

  function centerOnReno() {
    focusOnPoint({ lat: region.center.lat, lon: region.center.lon }, 10);
  }

  function centerOnAirport() {
    focusOnPoint(krnoPoint, 13);
  }

  function focusOnAircraft() {
    const aircraftPoints = filteredEvents
      .filter((event) => event.sourceType === "aircraft")
      .map((event) => ({
        lat: event.point.lat,
        lon: event.point.lon
      }));

    if (aircraftPoints.length === 0) {
      setAircraftRefreshState((current) => ({
        ...current,
        status: "error",
        message: "No live aircraft are available in the KRNO airspace box right now."
      }));
      return;
    }

    focusOnPoints(aircraftPoints);
    setAircraftRefreshState((current) => ({
      ...current,
      status: "success",
      message: `Focused ${aircraftPoints.length} live aircraft on the map.`
    }));
  }

  async function refreshAircraft(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setAircraftRefreshState((current) => ({
        ...current,
        status: "submitting",
        message: "Refreshing live aircraft around KRNO..."
      }));
    }

    try {
      const response = await fetch(`${clientGatewayApiUrl}/api/v1/aircraft/live?refresh=true`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Aircraft refresh failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        fetchedAt: string;
        count: number;
        items: SignalEvent[];
      };

      setLiveEvents((current) => {
        const nonAircraftEvents = current.filter((event) => event.sourceType !== "aircraft");
        return [...payload.items, ...nonAircraftEvents];
      });

      setAircraftRefreshState((current) => ({
        status: "success",
        message: options?.silent
          ? current.message
          : `Showing ${payload.count} live aircraft from ${new Date(payload.fetchedAt).toLocaleTimeString()}.`,
        fetchedAt: payload.fetchedAt
      }));

      if (!options?.silent && payload.items[0]) {
        setSelectedOverlay((current) => {
          if (current?.type === "event" && payload.items.some((item) => item.id === current.id)) {
            return current;
          }

          if (current?.type === "camera" || current?.type === "stack") {
            return current;
          }

          return { type: "event", id: payload.items[0].id };
        });
      }
    } catch (error) {
      setAircraftRefreshState((current) => ({
        ...current,
        status: "error",
        message: error instanceof Error ? error.message : "Aircraft refresh failed."
      }));
    }
  }

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshAircraft({ silent: true });
    }, AIRCRAFT_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [clientGatewayApiUrl]);

  function viewCameraOnDashboard(camera: CameraSource, options?: { openPopup?: boolean }) {
    setActiveViewerCameraId(camera.id);
    setSelectedOverlay({ type: "camera", id: camera.id });
    focusOnPoint(camera.point, 13);
    cameraViewerCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    if (options?.openPopup) {
      setIsCameraPopupOpen(true);
    }
  }

  function panMap(direction: MapDirection) {
    const stepPx = 140;

    if (mapMode === "google" && googleMapRef.current) {
      const panBy =
        direction === "north"
          ? { x: 0, y: -stepPx }
          : direction === "south"
            ? { x: 0, y: stepPx }
            : direction === "east"
              ? { x: stepPx, y: 0 }
              : { x: -stepPx, y: 0 };

      googleMapRef.current.panBy(panBy.x, panBy.y);
      return;
    }

    if (leafletMapRef.current) {
      const offset =
        direction === "north"
          ? [0, -stepPx]
          : direction === "south"
            ? [0, stepPx]
            : direction === "east"
              ? [stepPx, 0]
              : [-stepPx, 0];
      leafletMapRef.current.panBy(offset as [number, number], { animate: true });
    }
  }

  function zoomMap(direction: MapZoom) {
    if (mapMode === "google" && googleMapRef.current) {
      const currentZoom = googleMapRef.current.getZoom() ?? 10;
      googleMapRef.current.setZoom(direction === "in" ? currentZoom + 1 : currentZoom - 1);
      return;
    }

    if (leafletMapRef.current) {
      if (direction === "in") {
        leafletMapRef.current.zoomIn();
        return;
      }

      leafletMapRef.current.zoomOut();
    }
  }

  return (
    <div className="map-viewport">
      <div className="map-stage map-stage-live">
        <div className="map-control-dock">
          <div className="map-control-badges">
            <Badge tone="accent">{mapMode === "google" ? "Google Maps" : "Leaflet Optimized"}</Badge>
            <Badge tone={showWeatherOverlay ? "accent" : "neutral"}>
              Weather {showWeatherOverlay ? "On" : "Off"}
            </Badge>
            <Badge tone="neutral">{liveAircraftCount} live aircraft</Badge>
            <Badge tone="neutral">{flightSubscriptions.length} tracked flights</Badge>
          </div>

          <div className="map-control-section">
            <strong>Map controls</strong>
            <div className="map-action-group">
              <button type="button" className="map-action-button" onClick={fitRegion}>
                Fit Region
              </button>
              <button type="button" className="map-action-button" onClick={centerOnReno}>
                Center Reno
              </button>
              <button type="button" className="map-action-button" onClick={centerOnAirport}>
                Center KRNO
              </button>
              <button type="button" className="map-action-button" onClick={focusOnAircraft}>
                Focus Aircraft
              </button>
              <button
                type="button"
                className="map-action-button"
                onClick={() => {
                  void refreshAircraft();
                }}
                disabled={aircraftRefreshState.status === "submitting"}
              >
                {aircraftRefreshState.status === "submitting" ? "Refreshing..." : "Refresh Aircraft"}
              </button>
              <button type="button" className="map-action-button" onClick={() => zoomMap("in")}>
                Zoom In
              </button>
              <button type="button" className="map-action-button" onClick={() => zoomMap("out")}>
                Zoom Out
              </button>
            </div>
          </div>

          <div className="map-control-section">
            <strong>Layers</strong>
            <div className="map-action-group">
              <button
                type="button"
                className={`map-action-button ${showWeatherOverlay ? "is-active" : ""}`}
                onClick={() => setShowWeatherOverlay((current) => !current)}
              >
                {showWeatherOverlay ? "Hide Weather" : "Show Weather"}
              </button>
              <button type="button" className="map-action-button" onClick={() => setAllKinds(true)}>
                All Layers
              </button>
              <button type="button" className="map-action-button" onClick={() => setAllKinds(false)}>
                Clear Layers
              </button>
            </div>
          </div>

          <div className="map-control-section">
            <strong>Pan map</strong>
            <div className="map-dpad" aria-label="Map navigation pad">
              <button type="button" className="map-dpad-button map-dpad-north" onClick={() => panMap("north")}>
                N
              </button>
              <button type="button" className="map-dpad-button map-dpad-west" onClick={() => panMap("west")}>
                W
              </button>
              <button type="button" className="map-dpad-button map-dpad-center" onClick={centerOnAirport}>
                RNO
              </button>
              <button type="button" className="map-dpad-button map-dpad-east" onClick={() => panMap("east")}>
                E
              </button>
              <button type="button" className="map-dpad-button map-dpad-south" onClick={() => panMap("south")}>
                S
              </button>
            </div>
          </div>
        </div>

        <div ref={mapNodeRef} className="map-canvas" />

        <div className="map-status-row">
          <Badge tone="neutral">{filteredEvents.length} event overlays</Badge>
          <Badge tone="neutral">{filteredStacks.length} stack overlays</Badge>
          <Badge tone="neutral">{filteredCameras.length} cameras</Badge>
          {aircraftRefreshState.fetchedAt ? (
            <Badge tone="neutral">
              Aircraft {new Date(aircraftRefreshState.fetchedAt).toLocaleTimeString()}
            </Badge>
          ) : null}
        </div>

        {visibleKinds.camera && filteredCameras.length > 0 ? (
          <div className="map-camera-prompt">
            <strong>Camera viewer</strong>
            <div>
              Click a camera marker to load it into the dashboard viewer for {cameraScope === "rno_airport" ? "RNO airport" : "Reno"} cameras.
            </div>
          </div>
        ) : null}

        {mapState !== "ready" ? (
          <div className="map-overlay-state">
            {mapState === "error" ? (
              <>
                <strong>Map failed to load</strong>
                <div>Check the browser console and API key configuration.</div>
              </>
            ) : (
              <>
                <strong>Loading map</strong>
                <div>Starting the base map and overlay layers.</div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="map-sidepanel">
        <div ref={cameraViewerCardRef} className="map-sidecard map-sidecard-primary">
          {viewerCamera ? (
            <>
              <div className="camera-stage-top">
                <div className="camera-viewer-box camera-viewer-box-primary">
                  {viewerHasEmbeddedFeed ? (
                    <CameraMediaViewer title={viewerCamera.name} src={viewerCamera.previewUrl!} />
                  ) : (
                    <div className="camera-viewer-placeholder">
                      <div className="camera-viewer-placeholder-title">Live viewer ready</div>
                      <small>
                        This source is currently link-only. When the official Nevada 511 API provides a direct image or video URL, it will render in this box automatically.
                      </small>
                    </div>
                  )}
                </div>

                <div className="camera-viewer-header camera-viewer-header-tight">
                  <div className="camera-viewer-header-row">
                    <div>
                      <div className="camera-panel-kicker">Live camera feed</div>
                      <div className="camera-viewer-name">{viewerCamera.name}</div>
                      <small>
                        {viewerCamera.provider} | {cameraScopeLabel}
                      </small>
                    </div>
                    <div className="camera-viewer-badges">
                      <Badge tone={viewerHasEmbeddedFeed ? "accent" : "neutral"}>
                        {viewerHasEmbeddedFeed ? "Live on dashboard" : "Link-only source"}
                      </Badge>
                      <Badge tone="neutral">{mapMode === "google" ? "Google" : "Leaflet"}</Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div className="camera-controller-card">
                <div className="camera-controller-head">
                  <strong>Camera controls</strong>
                  <small>Select the feed and move the map without pushing the video lower.</small>
                </div>

                <div className="camera-selector-grid">
                  <div>
                    <label className="camera-select-label" htmlFor="camera-scope">
                      Camera set
                    </label>
                    <div className="camera-select-row">
                      <select
                        id="camera-scope"
                        className="camera-select"
                        value={cameraScope}
                        onChange={(event) => {
                          setCameraScope(event.target.value as CameraScope);
                        }}
                      >
                        <option value="rno_airport">RNO airport perimeter</option>
                        <option value="reno_corridor">Reno regional corridor</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="camera-select-label" htmlFor="camera-select">
                      Choose camera
                    </label>
                    <div className="camera-select-row">
                      <select
                        id="camera-select"
                        className="camera-select"
                        value={viewerCamera.id}
                        onChange={(event) => {
                          const nextCamera = filteredCameras.find((camera) => camera.id === event.target.value);
                          if (nextCamera) {
                            viewCameraOnDashboard(nextCamera);
                          }
                        }}
                      >
                        {orderedCameras.map((camera) => (
                          <option key={camera.id} value={camera.id}>
                            {camera.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="camera-action-row">
                  <button
                    type="button"
                    className="camera-select-button"
                    onClick={() => viewCameraOnDashboard(viewerCamera)}
                  >
                    Focus on map
                  </button>
                  <button
                    type="button"
                    className="camera-select-button"
                    onClick={centerOnAirport}
                  >
                    Jump to KRNO
                  </button>
                  <button
                    type="button"
                    className="camera-select-button camera-select-button-primary"
                    onClick={() => viewCameraOnDashboard(viewerCamera, { openPopup: true })}
                  >
                    Open live popup
                  </button>
                </div>
              </div>

              {!hasEmbeddedCameraFeed ? (
                <small className="camera-inline-note">
                  Live in-dashboard camera playback needs a real <code>NEVADA_511_API_KEY</code> in <code>.env.local</code> and a gateway restart.
                </small>
              ) : null}
              {cameraScope === "rno_airport" ? (
                <small className="camera-inline-note">
                  RNO airport mode favors public Nevada 511 cameras around KRNO, including Plumb Airport and nearby airport-approach views.
                </small>
              ) : null}
            </>
          ) : (
            <div>No active cameras are available in the current region and filters.</div>
          )}
        </div>

        <div className="map-sidepanel-scroll">
          <div className="map-sidecard">
            <strong>Active map context</strong>
            {selectedEvent ? (
              <>
                <div>{selectedEvent.summary}</div>
                <small>{formatEventMeta(selectedEvent)}</small>
                {selectedEvent.sourceType === "aircraft" && selectedFlightIdentifier ? (
                  <>
                    <div className="selected-link-row">
                      <button
                        type="button"
                        className="selected-link-button selected-link-button-secondary"
                        onClick={() => focusOnPoint(selectedEvent.point, 12)}
                      >
                        Center aircraft
                      </button>
                      <button
                        type="button"
                        className="selected-link-button"
                        onClick={subscribeSelectedFlight}
                        disabled={flightActionState.status === "submitting"}
                      >
                        {isSelectedFlightSubscribed ? "Webhook Active" : "Webhook Flight"}
                      </button>
                    </div>
                    <small>
                      {selectedAircraftHasTailNumber ? "Tail number" : "Aircraft ID"}:{" "}
                      {selectedAircraftDisplayId ?? selectedFlightIdentifier}
                      {" | "}
                      Flight number: {selectedFlightIdentifier}
                      {isSelectedFlightSubscribed ? " | highlighted on map" : ""}
                    </small>
                    {selectedAircraftTrack.length > 0 ? (
                      <div className="aircraft-track-panel">
                        <strong>Recent trajectory</strong>
                        <div className="aircraft-track-list">
                          {selectedAircraftTrack
                            .slice()
                            .reverse()
                            .map((point) => (
                              <div key={`${point.ts}-${point.lat}-${point.lon}`} className="aircraft-track-item">
                                <span>{new Date(point.ts).toLocaleTimeString()}</span>
                                <span>
                                  {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
                                </span>
                                <span>
                                  {point.altM !== null ? `${Math.round(point.altM * 3.28084).toLocaleString()} ft` : "alt n/a"}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            {selectedStack ? (
              <>
                <div>{selectedStack.title}</div>
                <small>{formatStackMeta(selectedStack)}</small>
              </>
            ) : null}
            {selectedCamera ? (
              <>
                <div>{selectedCamera.name}</div>
                <small>{selectedCamera.provider} | loaded into the live camera workspace above</small>
                <div className="selected-link-row">
                  <button
                    type="button"
                    className="selected-link-button"
                    onClick={() => viewCameraOnDashboard(selectedCamera)}
                  >
                    View on dashboard
                  </button>
                  <button
                    type="button"
                    className="selected-link-button selected-link-button-secondary"
                    onClick={() => viewCameraOnDashboard(selectedCamera, { openPopup: true })}
                  >
                    Live popup
                  </button>
                </div>
              </>
            ) : null}
            {!selectedEvent && !selectedStack && !selectedCamera ? (
              <div>Click an event, stack, or camera marker to inspect it.</div>
            ) : null}
            {flightActionState.message ? (
              <small
                className={
                  flightActionState.status === "error"
                    ? "camera-inline-note camera-inline-note-danger"
                    : "camera-inline-note"
                }
              >
                {flightActionState.message}
              </small>
            ) : null}
            {aircraftRefreshState.message ? (
              <small
                className={
                  aircraftRefreshState.status === "error"
                    ? "camera-inline-note camera-inline-note-danger"
                    : "camera-inline-note"
                }
              >
                {aircraftRefreshState.message}
              </small>
            ) : null}
          </div>

          <div className="map-sidecard">
            <strong>Overlay controls</strong>
            <div className="filter-list">
              {FILTERABLE_SOURCE_KINDS.map((kind) => (
                <label key={kind} className="filter-item">
                  <span className="filter-item-main">
                    <input
                      type="checkbox"
                      checked={visibleKinds[kind]}
                      onChange={() => toggleKind(kind)}
                    />
                    <span className="filter-swatch" style={{ background: SOURCE_COLORS[kind] }} />
                    <span>{SOURCE_LABELS[kind]}</span>
                  </span>
                  <span className="filter-count">{sourceCounts[kind] ?? 0}</span>
                </label>
              ))}
            </div>
            <small>Keep the live viewer fixed above and quickly reduce map noise here without changing the base map.</small>
          </div>

          <div className="map-sidecard map-sidecard-muted">
            <strong>Workspace status</strong>
            <div className="map-meta-list">
              <span>{mapMode === "google" ? "Google Maps base available" : "Leaflet base active"}</span>
              <span>{showWeatherOverlay ? "Doppler and clouds on" : "Weather overlay off"}</span>
              <span>Cameras use Nevada 511 API</span>
            </div>
            <small>
              This section stays compact so the right rail can prioritize live video now and scanner or transcript modules later.
            </small>
          </div>
        </div>
      </div>

      {isCameraPopupOpen && viewerCamera && typeof document !== "undefined"
        ? createPortal(
            <div className="camera-popup-backdrop" onClick={() => setIsCameraPopupOpen(false)}>
              <div
                className="camera-popup"
                role="dialog"
                aria-modal="true"
                aria-label={`${viewerCamera.name} live popup`}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="camera-popup-header">
                  <div>
                    <strong>{viewerCamera.name}</strong>
                    <div className="camera-popup-subtitle">
                      {cameraScope === "rno_airport" ? "RNO airport perimeter live popup" : "Reno corridor live popup"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="camera-popup-close"
                    onClick={() => setIsCameraPopupOpen(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="camera-popup-stage">
                  {viewerCamera.embedMode === "embed" && viewerCamera.previewUrl ? (
                    <CameraMediaViewer title={viewerCamera.name} src={viewerCamera.previewUrl} />
                  ) : (
                    <div className="camera-viewer-placeholder">
                      <div className="camera-viewer-placeholder-title">Live feed unavailable</div>
                      <small>This camera does not currently expose a direct public media URL for embedded playback.</small>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

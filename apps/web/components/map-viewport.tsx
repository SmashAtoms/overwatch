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
import type {
  Layer,
  LayerGroup,
  Map as LeafletMap,
  Marker as LeafletMarker,
  Polyline as LeafletPolyline
} from "leaflet";
import { CameraMediaViewer } from "./camera-media-viewer";
import type { FlightSubscriptionRecord } from "../lib/api";
import { AircraftStore, type AircraftRenderable, type AircraftTrailPoint } from "../lib/aircraft-store";

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

type SelectedOverlay =
  | { type: "event"; id: string }
  | { type: "stack"; id: string }
  | { type: "camera"; id: string }
  | null;

type LeafletAircraftLayerRecord = {
  marker: LeafletMarker;
  trail: LeafletPolyline | null;
};

type MapMode = "google" | "leaflet";
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

function getAircraftHeading(event: SignalEvent): number {
  return typeof event.rawPayload?.headingDeg === "number" ? event.rawPayload.headingDeg : 0;
}

function getAircraftStableId(event: SignalEvent | null): string | null {
  if (!event || event.sourceType !== "aircraft") {
    return null;
  }

  const rawIcao24 = event.rawPayload?.icao24;
  if (typeof rawIcao24 === "string" && rawIcao24.trim()) {
    return rawIcao24.trim().toLowerCase();
  }

  const entityIcao24 = event.entities?.find((entity) => entity.kind === "icao24")?.value;
  if (entityIcao24?.trim()) {
    return entityIcao24.trim().toLowerCase();
  }

  const rawCallsign = event.rawPayload?.callsign;
  if (typeof rawCallsign === "string" && rawCallsign.trim()) {
    return rawCallsign.trim().toLowerCase();
  }

  return event.id;
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

function normalizeCompare(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function buildCameraMarkerOffsets(cameras: CameraSource[]) {
  const grouped = new Map<string, CameraSource[]>();

  cameras.forEach((camera) => {
    const key = `${camera.point.lat.toFixed(5)}:${camera.point.lon.toFixed(5)}`;
    const group = grouped.get(key) ?? [];
    group.push(camera);
    grouped.set(key, group);
  });

  const offsets = new Map<string, { lat: number; lon: number }>();

  grouped.forEach((group) => {
    if (group.length === 1) {
      offsets.set(group[0].id, { lat: group[0].point.lat, lon: group[0].point.lon });
      return;
    }

    const radius = 0.0032;
    group.forEach((camera, index) => {
      const angle = (Math.PI * 2 * index) / group.length;
      offsets.set(camera.id, {
        lat: camera.point.lat + Math.sin(angle) * radius,
        lon: camera.point.lon + Math.cos(angle) * radius
      });
    });
  });

  return offsets;
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
  const isMilitaryAircraft = event.rawPayload?.isMilitary === true;
  const bodyColor = isSubscribedFlight
    ? "#7de2d1"
    : isMilitaryAircraft
      ? "#ff8a5b"
      : SOURCE_COLORS.aircraft;
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
  const leafletAircraftGroupRef = useRef<LayerGroup | null>(null);
  const leafletAircraftLayersRef = useRef<Map<string, LeafletAircraftLayerRecord>>(new Map());
  const leafletEventGroupRef = useRef<LayerGroup | null>(null);
  const leafletStackGroupRef = useRef<LayerGroup | null>(null);
  const leafletCameraGroupRef = useRef<LayerGroup | null>(null);
  const leafletWeatherGroupRef = useRef<LayerGroup | null>(null);
  const aircraftStoreRef = useRef(new AircraftStore());
  const persistedLeafletViewRef = useRef<{ center: { lat: number; lon: number }; zoom: number } | null>(null);
  const persistedGoogleViewRef = useRef<{ center: { lat: number; lon: number }; zoom: number } | null>(null);
  const initialCamera = cameras.find((camera) => camera.id === DEFAULT_CAMERA_ID) ?? cameras[0] ?? null;
  const [selectedOverlay, setSelectedOverlay] = useState<SelectedOverlay>(() => {
    return initialCamera ? { type: "camera", id: initialCamera.id } : null;
  });
  const [liveEvents, setLiveEvents] = useState<SignalEvent[]>(events);
  const [aircraftRenderables, setAircraftRenderables] = useState<AircraftRenderable[]>(() => {
    const store = aircraftStoreRef.current;
    store.seed(events, Date.now());
    return store.getRenderables();
  });
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">("loading");
  const [mapMode, setMapMode] = useState<MapMode>("leaflet");
  const [activeViewerCameraId, setActiveViewerCameraId] = useState<string | null>(() => initialCamera?.id ?? null);
  const [isCameraPopupOpen, setIsCameraPopupOpen] = useState(false);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
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
    aircraft: false,
    atc: false,
    scanner: false,
    weather: false,
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

  const nonAircraftVisibleEvents = useMemo(
    () =>
      liveEvents.filter(
        (event) =>
          event.sourceType !== "aircraft" &&
          event.sourceType !== "camera" &&
          isSourceVisible(event.sourceType)
      ),
    [liveEvents, showWeatherOverlay, visibleKinds]
  );
  const visibleAircraftEvents = useMemo(
    () => (visibleKinds.aircraft ? aircraftRenderables.map((renderable) => renderable.event) : []),
    [aircraftRenderables, visibleKinds.aircraft]
  );
  const filteredEvents = useMemo(
    () => [...visibleAircraftEvents, ...nonAircraftVisibleEvents],
    [nonAircraftVisibleEvents, visibleAircraftEvents]
  );
  const mapRenderableEvents = useMemo(
    () => filteredEvents.filter((event) => event.sourceType !== "weather"),
    [filteredEvents]
  );
  const mapRenderableAircraft = useMemo(
    () => (visibleKinds.aircraft ? aircraftRenderables : []),
    [aircraftRenderables, visibleKinds.aircraft]
  );
  const mapRenderableSignalEvents = useMemo(
    () => mapRenderableEvents.filter((event) => event.sourceType !== "aircraft"),
    [mapRenderableEvents]
  );
  const krnoPoint = useMemo(() => {
    const krnoViewpoint = region.savedViewpoints.find((viewpoint) => viewpoint.id === "krno");
    return krnoViewpoint ? { lat: krnoViewpoint.point.lat, lon: krnoViewpoint.point.lon } : { lat: 39.4991, lon: -119.7681 };
  }, [region.savedViewpoints]);
  const scopedCameras = useMemo(
    () =>
      cameras
        .filter((camera) => camera.status === "active")
        .sort((left, right) => {
          if (left.id === DEFAULT_CAMERA_ID) {
            return -1;
          }

          if (right.id === DEFAULT_CAMERA_ID) {
            return 1;
          }

          const embedScore = Number(right.embedMode === "embed") - Number(left.embedMode === "embed");
          return embedScore !== 0 ? embedScore : left.name.localeCompare(right.name);
        }),
    [cameras]
  );
  const filteredCameras = useMemo(
    () => (visibleKinds.camera ? scopedCameras : []),
    [scopedCameras, visibleKinds.camera]
  );
  const cameraMarkerOffsets = useMemo(() => buildCameraMarkerOffsets(filteredCameras), [filteredCameras]);
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
      ? filteredEvents.find((event) => event.id === selectedOverlay.id) ??
        aircraftRenderables.find((renderable) => renderable.key === selectedOverlay.id)?.event ??
        null
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
  const selectedAircraftIsMilitary = selectedEvent?.rawPayload?.isMilitary === true;
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
  const selectedAircraftTrack: AircraftTrailPoint[] = useMemo(() => {
    if (selectedEvent?.sourceType !== "aircraft") {
      return [];
    }

    const selectedAircraftId = getAircraftStableId(selectedEvent);

    return (
      aircraftRenderables.find(
        (renderable) =>
          renderable.key === selectedOverlay?.id ||
          (selectedAircraftId !== null && renderable.key === selectedAircraftId) ||
          renderable.event.id === selectedEvent.id
      )?.trail ?? []
    );
  }, [aircraftRenderables, selectedEvent, selectedOverlay]);

  function mergeIntoExistingAircraftStore(newAircraftEvents: SignalEvent[], fetchedAt?: string | null) {
    const nowMs = Date.now();
    aircraftStoreRef.current.updateFromEvents(newAircraftEvents, nowMs);
    setAircraftRenderables(aircraftStoreRef.current.getRenderables());
    setLiveEvents((current) => {
      const nonAircraftEvents = current.filter((event) => event.sourceType !== "aircraft");
      const mergedAircraftEvents = aircraftStoreRef.current.getRenderables().map((renderable) => renderable.event);
      return [...mergedAircraftEvents, ...nonAircraftEvents];
    });
    if (fetchedAt) {
      setAircraftRefreshState((current) => ({
        ...current,
        fetchedAt
      }));
    }
  }

  useEffect(() => {
    setLiveEvents(events);
    aircraftStoreRef.current.seed(events, Date.now());
    setAircraftRenderables(aircraftStoreRef.current.getRenderables());
    setAircraftRefreshState((current) => ({
      ...current,
      fetchedAt: events.find((event) => event.sourceType === "aircraft")?.ingestedAt ?? current.fetchedAt
    }));
  }, [events]);

  useEffect(() => {
    aircraftStoreRef.current.updateFromEvents(
      liveEvents.filter((event) => event.sourceType === "aircraft"),
      Date.now()
    );
    setAircraftRenderables(aircraftStoreRef.current.getRenderables());
  }, [liveEvents]);

  useEffect(() => {
    let frameId = 0;

    const animate = (now: number) => {
      setAircraftRenderables(aircraftStoreRef.current.tick(now));
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

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
        leafletAircraftGroupRef.current = L.layerGroup().addTo(map);
        leafletEventGroupRef.current = L.layerGroup().addTo(map);
        leafletStackGroupRef.current = L.layerGroup().addTo(map);
        leafletCameraGroupRef.current = L.layerGroup().addTo(map);
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

    setMapState("loading");
    void initLeafletMap();

    return () => {
      cancelled = true;
      leafletAircraftGroupRef.current?.clearLayers();
      leafletAircraftLayersRef.current.clear();
      leafletEventGroupRef.current?.clearLayers();
      leafletStackGroupRef.current?.clearLayers();
      leafletCameraGroupRef.current?.clearLayers();
      leafletWeatherGroupRef.current?.clearLayers();
      leafletAircraftGroupRef.current = null;
      leafletEventGroupRef.current = null;
      leafletStackGroupRef.current = null;
      leafletCameraGroupRef.current = null;
      leafletWeatherGroupRef.current = null;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [region]);

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
    const eventGroup = leafletEventGroupRef.current;
    if (!map || !eventGroup) {
      return;
    }

    let cancelled = false;

    async function syncEventLayers() {
      const leafletModule = await import("leaflet");
      const L = leafletModule.default;

      if (cancelled || !leafletEventGroupRef.current) {
        return;
      }

      const overlayGroup = leafletEventGroupRef.current;
      overlayGroup.clearLayers();

      mapRenderableSignalEvents.forEach((event) => {
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

      });
    }

    void syncEventLayers();

    return () => {
      cancelled = true;
    };
  }, [mapRenderableSignalEvents, mapState, subscribedFlightNumbers]);

  useEffect(() => {
    const map = leafletMapRef.current;
    const aircraftGroup = leafletAircraftGroupRef.current;
    if (!map || !aircraftGroup) {
      return;
    }

    let cancelled = false;

    async function syncAircraftLayers() {
      const leafletModule = await import("leaflet");
      const L = leafletModule.default;

      if (cancelled || !leafletAircraftGroupRef.current) {
        return;
      }

      const overlayGroup = leafletAircraftGroupRef.current;
      const aircraftLayers = leafletAircraftLayersRef.current;
      const nextKeys = new Set<string>();

      mapRenderableAircraft.forEach((renderable) => {
        const event = renderable.event;
        const aircraftDisplayId = getAircraftDisplayIdentifier(event);
        const eventFlightIdentifier = getFlightSubscriptionIdentifier(event);
        const isSubscribedFlight =
          eventFlightIdentifier ? subscribedFlightNumbers.has(eventFlightIdentifier) : false;

        if (!aircraftDisplayId) {
          return;
        }

        nextKeys.add(renderable.key);

        const tooltipContent = `${aircraftDisplayId} | ${renderable.stale ? "stale track" : event.summary}`;
        const icon = L.divIcon(createLeafletAircraftIcon(event, aircraftDisplayId, isSubscribedFlight));
        let layerRecord = aircraftLayers.get(renderable.key);

        if (!layerRecord) {
          const marker = L.marker([renderable.lat, renderable.lon], {
            opacity: renderable.opacity,
            icon
          }).bindTooltip(tooltipContent);

          marker.on("click", () => {
            setSelectedOverlay({ type: "event", id: renderable.key });
          });

          overlayGroup.addLayer(marker);
          layerRecord = {
            marker,
            trail: null
          };
          aircraftLayers.set(renderable.key, layerRecord);
        } else {
          layerRecord.marker.setLatLng([renderable.lat, renderable.lon]);
          layerRecord.marker.setOpacity(renderable.opacity);
          layerRecord.marker.setIcon(icon);
          if (layerRecord.marker.getTooltip()) {
            layerRecord.marker.setTooltipContent(tooltipContent);
          } else {
            layerRecord.marker.bindTooltip(tooltipContent);
          }
        }

        if (
          selectedEvent?.sourceType === "aircraft" &&
          (selectedOverlay?.id === renderable.key || selectedEvent.id === event.id)
        ) {
          const trajectoryPath = renderable.trail.map((point) => [point.lat, point.lon] as [number, number]);
          if (trajectoryPath.length > 1) {
            if (!layerRecord.trail) {
              layerRecord.trail = L.polyline(trajectoryPath, {
                color: isSubscribedFlight ? "#ffcf6e" : SOURCE_COLORS.aircraft,
                weight: isSubscribedFlight ? 4 : 3,
                opacity: renderable.opacity * 0.9,
                smoothFactor: 1.2
              });
              overlayGroup.addLayer(layerRecord.trail);
            } else {
              layerRecord.trail.setLatLngs(trajectoryPath);
              layerRecord.trail.setStyle({
                color: isSubscribedFlight ? "#ffcf6e" : SOURCE_COLORS.aircraft,
                weight: isSubscribedFlight ? 4 : 3,
                opacity: renderable.opacity * 0.9
              });
            }
          } else if (layerRecord.trail) {
            overlayGroup.removeLayer(layerRecord.trail);
            layerRecord.trail = null;
          }
        } else if (layerRecord.trail) {
          overlayGroup.removeLayer(layerRecord.trail);
          layerRecord.trail = null;
        }
      });

      aircraftLayers.forEach((layerRecord, key) => {
        if (nextKeys.has(key)) {
          return;
        }

        if (layerRecord.trail) {
          overlayGroup.removeLayer(layerRecord.trail);
        }
        overlayGroup.removeLayer(layerRecord.marker);
        aircraftLayers.delete(key);
      });
    }

    void syncAircraftLayers();

    return () => {
      cancelled = true;
    };
  }, [mapRenderableAircraft, mapState, selectedEvent, selectedOverlay, subscribedFlightNumbers]);

  useEffect(() => {
    const map = leafletMapRef.current;
    const stackGroup = leafletStackGroupRef.current;
    if (!map || !stackGroup) {
      return;
    }

    let cancelled = false;

    async function syncStackLayers() {
      const leafletModule = await import("leaflet");
      const L = leafletModule.default;

      if (cancelled || !leafletStackGroupRef.current) {
        return;
      }

      const overlayGroup = leafletStackGroupRef.current;
      overlayGroup.clearLayers();

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
    }

    void syncStackLayers();

    return () => {
      cancelled = true;
    };
  }, [filteredStacks, mapState]);

  useEffect(() => {
    const map = leafletMapRef.current;
    const cameraGroup = leafletCameraGroupRef.current;
    if (!map || !cameraGroup) {
      return;
    }

    let cancelled = false;

    async function syncCameraLayers() {
      const leafletModule = await import("leaflet");
      const L = leafletModule.default;

      if (cancelled || !leafletCameraGroupRef.current) {
        return;
      }

      const overlayGroup = leafletCameraGroupRef.current;
      overlayGroup.clearLayers();

      filteredCameras.forEach((camera) => {
        const isActiveCamera = activeViewerCameraId === camera.id;
        const markerPoint = cameraMarkerOffsets.get(camera.id) ?? camera.point;
        const marker = L.circleMarker([markerPoint.lat, markerPoint.lon], {
          radius: isActiveCamera ? 10 : 8,
          fillColor: SOURCE_COLORS.camera,
          color: isActiveCamera ? "#eef6ff" : "#07111f",
          weight: isActiveCamera ? 3 : 2,
          opacity: 1,
          fillOpacity: 0.95
        }).bindTooltip(camera.name);

        marker.on("click", () => {
          viewCameraOnDashboard(camera);
        });

        overlayGroup.addLayer(marker);
      });
    }

    void syncCameraLayers();

    return () => {
      cancelled = true;
    };
  }, [activeViewerCameraId, cameraMarkerOffsets, filteredCameras, mapState]);

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
      const refreshQuery = options?.silent ? "" : "?refresh=true";
      const response = await fetch(`${clientGatewayApiUrl}/api/v1/aircraft/live${refreshQuery}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as
        | {
            ok: true;
            fetchedAt: string;
            count: number;
            items: SignalEvent[];
          }
        | {
            ok: false;
            error: string;
          };

      if (!response.ok || !payload.ok) {
        setAircraftRefreshState((current) => ({
          ...current,
          status: "error",
          message:
            "error" in payload
              ? payload.error
              : "Live aircraft data is temporarily unavailable."
        }));
        return;
      }

      mergeIntoExistingAircraftStore(payload.items, payload.fetchedAt);

      setAircraftRefreshState((current) => ({
        status: "success",
        message: options?.silent
          ? current.message
          : `Showing ${payload.count} live aircraft from ${new Date(payload.fetchedAt).toLocaleTimeString()}.`,
        fetchedAt: payload.fetchedAt
      }));

      if (!options?.silent && payload.items[0]) {
        setSelectedOverlay((current) => {
          if (
            current?.type === "event" &&
            payload.items.some(
              (item) => item.id === current.id || getAircraftStableId(item) === current.id
            )
          ) {
            return current;
          }

          if (current?.type === "camera" || current?.type === "stack") {
            return current;
          }

          return { type: "event", id: getAircraftStableId(payload.items[0]) ?? payload.items[0].id };
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
    if (!visibleKinds.aircraft) {
      return;
    }

    void refreshAircraft({ silent: true });

    const interval = window.setInterval(() => {
      void refreshAircraft({ silent: true });
    }, AIRCRAFT_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [clientGatewayApiUrl, visibleKinds.aircraft]);

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

  async function toggleAircraftLayer() {
    if (visibleKinds.aircraft) {
      setVisibleKinds((current) => ({
        ...current,
        aircraft: false
      }));
      return;
    }

    setVisibleKinds((current) => ({
      ...current,
      aircraft: true
    }));
    await refreshAircraft();
  }

  function toggleCameraLayer() {
    setVisibleKinds((current) => ({
      ...current,
      camera: !current.camera
    }));
  }

  return (
    <div className="map-viewport">
      <div className="map-stage map-stage-live">
        <div className="map-control-dock">
          <div className="map-control-section">
            <strong>Map controls</strong>
            <div className="map-action-group">
              <button type="button" className="map-action-button" onClick={fitRegion}>
                Fit Region
              </button>
              <button type="button" className="map-action-button" onClick={centerOnAirport}>
                Center KRNO
              </button>
              <button
                type="button"
                className={`map-action-button ${visibleKinds.aircraft ? "is-active" : ""}`}
                onClick={() => {
                  void toggleAircraftLayer();
                }}
                disabled={aircraftRefreshState.status === "submitting"}
              >
                {aircraftRefreshState.status === "submitting"
                  ? "Loading Aircraft..."
                  : visibleKinds.aircraft
                    ? "Aircraft On"
                    : "Aircraft Off"}
              </button>
              <button
                type="button"
                className={`map-action-button ${visibleKinds.camera ? "is-active" : ""}`}
                onClick={toggleCameraLayer}
              >
                {visibleKinds.camera ? "Cams On" : "Cams Off"}
              </button>
              <button type="button" className="map-action-button" onClick={() => zoomMap("in")}>
                Zoom In
              </button>
              <button type="button" className="map-action-button" onClick={() => zoomMap("out")}>
                Zoom Out
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
            <div>Click any camera marker to load that live feed into the dashboard viewer.</div>
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
                    <CameraMediaViewer
                      key={`${viewerCamera.id}-${viewerCamera.previewUrl}`}
                      title={viewerCamera.name}
                      src={viewerCamera.previewUrl!}
                    />
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
                      <small>{viewerCamera.provider}</small>
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
                  <small>Choose any live camera here or click one directly on the map.</small>
                </div>

                <div className="camera-selector-grid">
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
                    onClick={() => focusOnPoint(viewerCamera.point, 13)}
                  >
                    Jump to camera
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
            </>
          ) : (
            <div>No active cameras are available in the current region and filters.</div>
          )}
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
                      Live camera popup
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
                    <CameraMediaViewer
                      key={`popup-${viewerCamera.id}-${viewerCamera.previewUrl}`}
                      title={viewerCamera.name}
                      src={viewerCamera.previewUrl}
                    />
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

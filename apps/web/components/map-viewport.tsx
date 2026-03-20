"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CameraSource,
  InformationStack,
  RegionConfig,
  SignalEvent,
  SourceKind
} from "@signalstack/contracts";
import { Badge } from "@signalstack/ui";
import type { Layer, Map as LeafletMap } from "leaflet";
import { CameraMediaViewer } from "./camera-media-viewer";

type MapViewportProps = {
  region: RegionConfig;
  events: SignalEvent[];
  stacks: InformationStack[];
  cameras: CameraSource[];
};

type SelectedOverlay =
  | { type: "event"; id: string }
  | { type: "stack"; id: string }
  | { type: "camera"; id: string }
  | null;

type MapMode = "google" | "leaflet";
type CameraScope = "rno_airport" | "reno_corridor";

const NOAA_DOPPLER_WMS_URL = "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows";
const NOAA_DOPPLER_LAYER = "conus_bref_qcd";

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

export function MapViewport({ region, events, stacks, cameras }: MapViewportProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const cameraViewerCardRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const leafletMapRef = useRef<LeafletMap | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<SelectedOverlay>(null);
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">("loading");
  const [mapMode, setMapMode] = useState<MapMode>("leaflet");
  const [cameraScope, setCameraScope] = useState<CameraScope>("rno_airport");
  const [showRadar, setShowRadar] = useState(true);
  const [visibleKinds, setVisibleKinds] = useState<Record<SourceKind, boolean>>({
    aircraft: true,
    atc: true,
    scanner: true,
    weather: true,
    camera: true
  });

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const filteredEvents = useMemo(
    () => events.filter((event) => visibleKinds[event.sourceType] && event.sourceType !== "camera"),
    [events, visibleKinds]
  );
  const krnoPoint = useMemo(() => {
    const krnoViewpoint = region.savedViewpoints.find((viewpoint) => viewpoint.id === "krno");
    return krnoViewpoint ? { lat: krnoViewpoint.point.lat, lon: krnoViewpoint.point.lon } : { lat: 39.4991, lon: -119.7681 };
  }, [region.savedViewpoints]);
  const scopedCameras = useMemo(() => {
    const activeCameras = cameras.filter((camera) => camera.status === "active");

    if (cameraScope === "reno_corridor") {
      return activeCameras;
    }

    return activeCameras.filter((camera) => milesBetween(krnoPoint, camera.point) <= 5);
  }, [cameraScope, cameras, krnoPoint]);
  const filteredCameras = useMemo(
    () => (visibleKinds.camera ? scopedCameras : []),
    [scopedCameras, visibleKinds.camera]
  );
  const filteredStacks = useMemo(
    () => stacks.filter((stack) => stack.sources.some((source) => visibleKinds[source])),
    [stacks, visibleKinds]
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
  const viewerCamera = selectedCamera ?? filteredCameras[0] ?? null;
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
    counts.camera = filteredCameras.length;
    return counts;
  }, [filteredEvents, filteredCameras]);

  useEffect(() => {
    if (filteredCameras.length === 0) {
      if (selectedOverlay?.type === "camera") {
        setSelectedOverlay(null);
      }
      return;
    }

    if (!selectedOverlay) {
      setSelectedOverlay({ type: "camera", id: filteredCameras[0].id });
      return;
    }

    if (
      selectedOverlay.type === "camera" &&
      !filteredCameras.some((camera) => camera.id === selectedOverlay.id)
    ) {
      setSelectedOverlay({ type: "camera", id: filteredCameras[0].id });
    }
  }, [filteredCameras, selectedOverlay]);

  useEffect(() => {
    if (!mapNodeRef.current) {
      return;
    }

    let cancelled = false;
    const cleanupGoogle: Array<google.maps.Marker | google.maps.Polyline> = [];
    const cleanupLeaflet: Array<Layer> = [];

    async function initMap() {
      try {
        if (apiKey && !showRadar) {
          try {
            const maps = await loadGoogleMaps(apiKey);

            if (!mapNodeRef.current || cancelled) {
              return;
            }

            setMapMode("google");
            mapNodeRef.current.innerHTML = "";

            const map = new maps.Map(mapNodeRef.current, {
              center: { lat: region.center.lat, lng: region.center.lon },
              zoom: 9,
              styles: MAP_STYLE,
              disableDefaultUI: true,
              zoomControl: true,
              fullscreenControl: true,
              streetViewControl: false,
              mapTypeControl: false
            });

            googleMapRef.current = map;
            const bounds = new maps.LatLngBounds(
              { lat: region.bbox[1], lng: region.bbox[0] },
              { lat: region.bbox[3], lng: region.bbox[2] }
            );
            map.fitBounds(bounds, 32);

            filteredEvents.forEach((event) => {
              const marker = new maps.Marker({
                map,
                position: { lat: event.point.lat, lng: event.point.lon },
                title: event.summary,
                icon: {
                  path: maps.SymbolPath.CIRCLE,
                  scale: event.sourceType === "aircraft" ? 8 : 6,
                  fillColor: SOURCE_COLORS[event.sourceType],
                  fillOpacity: 0.95,
                  strokeColor: "#07111f",
                  strokeWeight: 2
                }
              });

              marker.addListener("click", () => {
                setSelectedOverlay({ type: "event", id: event.id });
              });

              cleanupGoogle.push(marker);

              if (event.sourceType === "aircraft") {
                const trail = new maps.Polyline({
                  map,
                  path: createAircraftTrail(event),
                  geodesic: true,
                  strokeColor: SOURCE_COLORS.aircraft,
                  strokeOpacity: 0.9,
                  strokeWeight: 3
                });
                cleanupGoogle.push(trail);
              }
            });

            filteredStacks.forEach((stack) => {
              const marker = new maps.Marker({
                map,
                position: { lat: stack.centroid.lat, lng: stack.centroid.lon },
                title: stack.title,
                zIndex: 100,
                icon: {
                  path: "M -12,0 0,-12 12,0 0,12 z",
                  fillColor: "#ffffff",
                  fillOpacity: 0.9,
                  strokeColor: stack.policy.restricted ? SOURCE_COLORS.scanner : SOURCE_COLORS.atc,
                  strokeWeight: 2,
                  scale: 1
                }
              });

              marker.addListener("click", () => {
                setSelectedOverlay({ type: "stack", id: stack.id });
              });

              cleanupGoogle.push(marker);
            });

            filteredCameras.forEach((camera) => {
              const marker = new maps.Marker({
                map,
                position: { lat: camera.point.lat, lng: camera.point.lon },
                title: camera.name,
                zIndex: 120,
                icon: {
                  path: "M -10,-8 10,-8 10,8 -10,8 z",
                  fillColor: SOURCE_COLORS.camera,
                  fillOpacity: 0.95,
                  strokeColor: "#07111f",
                  strokeWeight: 2,
                  scale: 1
                }
              });

              marker.addListener("click", () => {
                setSelectedOverlay({ type: "camera", id: camera.id });
              });

              cleanupGoogle.push(marker);
            });

            setMapState("ready");
            return;
          } catch (_error) {
            setMapMode("leaflet");
          }
        }

        if (!mapNodeRef.current || cancelled) {
          return;
        }

        mapNodeRef.current.innerHTML = "";
        const leafletModule = await import("leaflet");
        const L = leafletModule.default;
        const map = L.map(mapNodeRef.current, {
          zoomControl: true,
          attributionControl: true
        });

        leafletMapRef.current = map;

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors"
        }).addTo(map);

        if (showRadar) {
          const radarLayer = L.tileLayer.wms(NOAA_DOPPLER_WMS_URL, {
            layers: NOAA_DOPPLER_LAYER,
            format: "image/png",
            transparent: true,
            opacity: 0.58,
            version: "1.3.0",
            attribution: "NOAA/NCEP MRMS Composite Radar"
          }).addTo(map);

          cleanupLeaflet.push(radarLayer);
        }

        map.fitBounds(createRegionBounds(region), {
          padding: [24, 24]
        });

        filteredEvents.forEach((event) => {
          const marker = L.circleMarker([event.point.lat, event.point.lon], {
            radius: event.sourceType === "aircraft" ? 8 : 6,
            fillColor: SOURCE_COLORS[event.sourceType],
            color: "#07111f",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.95
          })
            .addTo(map)
            .bindTooltip(event.summary);

          marker.on("click", () => {
            setSelectedOverlay({ type: "event", id: event.id });
          });

          cleanupLeaflet.push(marker);

          if (event.sourceType === "aircraft") {
            const trail = L.polyline(
              createAircraftTrail(event).map((point) => [point.lat, point.lng] as [number, number]),
              {
                color: SOURCE_COLORS.aircraft,
                weight: 3,
                opacity: 0.9
              }
            ).addTo(map);
            cleanupLeaflet.push(trail);
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
          })
            .addTo(map)
            .bindTooltip(stack.title);

          marker.on("click", () => {
            setSelectedOverlay({ type: "stack", id: stack.id });
          });

          cleanupLeaflet.push(marker);
        });

        filteredCameras.forEach((camera) => {
          const marker = L.circleMarker([camera.point.lat, camera.point.lon], {
            radius: 8,
            fillColor: SOURCE_COLORS.camera,
            color: "#07111f",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.95
          })
            .addTo(map)
            .bindTooltip(camera.name);

          marker.on("click", () => {
            setSelectedOverlay({ type: "camera", id: camera.id });
          });

          cleanupLeaflet.push(marker);
        });

        setMapState("ready");
      } catch (_error) {
        if (!cancelled) {
          setMapState("error");
        }
      }
    }

    setMapState("loading");
    void initMap();

    return () => {
      cancelled = true;
      cleanupGoogle.forEach((overlay) => overlay.setMap(null));
      cleanupLeaflet.forEach((overlay) => overlay.remove());
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
      googleMapRef.current = null;
    };
  }, [apiKey, filteredCameras, filteredEvents, filteredStacks, region, showRadar]);

  function toggleKind(kind: SourceKind) {
    setVisibleKinds((current) => ({
      ...current,
      [kind]: !current[kind]
    }));
  }

  function setAllKinds(nextValue: boolean) {
    setVisibleKinds({
      aircraft: nextValue,
      atc: nextValue,
      scanner: nextValue,
      weather: nextValue,
      camera: nextValue
    });
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

  function viewCameraOnDashboard(camera: CameraSource) {
    setSelectedOverlay({ type: "camera", id: camera.id });
    focusOnPoint(camera.point, 13);
    cameraViewerCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  return (
    <div className="map-viewport">
      <div className="map-stage map-stage-live">
        <div className="map-toolbar">
          <Badge tone="accent">{mapMode === "google" ? "Google Maps" : "Leaflet Fallback"}</Badge>
          <Badge tone={showRadar ? "accent" : "neutral"}>Live Doppler {showRadar ? "On" : "Off"}</Badge>
          <Badge tone="neutral">{filteredEvents.length} event overlays</Badge>
          <Badge tone="neutral">{filteredStacks.length} stack overlays</Badge>
        </div>

        <div className="map-actions">
          <div className="map-action-group">
            <button type="button" className="map-action-button" onClick={fitRegion}>
              Fit Region
            </button>
            <button type="button" className="map-action-button" onClick={centerOnReno}>
              Center Reno
            </button>
          </div>
          <div className="map-action-group">
            <button
              type="button"
              className={`map-action-button ${showRadar ? "is-active" : ""}`}
              onClick={() => setShowRadar((current) => !current)}
            >
              {showRadar ? "Hide Doppler" : "Show Doppler"}
            </button>
            <button type="button" className="map-action-button" onClick={() => setAllKinds(true)}>
              All Layers
            </button>
            <button type="button" className="map-action-button" onClick={() => setAllKinds(false)}>
              Clear Layers
            </button>
          </div>
        </div>

        <div ref={mapNodeRef} className="map-canvas" />

        {visibleKinds.camera && filteredCameras.length > 0 ? (
          <div className="map-camera-prompt">
            <strong>Camera viewer</strong>
            <div>
              Click a camera marker to load it into the {cameraScope === "rno_airport" ? "RNO airport" : "Reno"} viewer.
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
        <div className="map-sidecard">
          <strong>Map provider</strong>
          <div>{mapMode === "google" ? "Google Maps JavaScript API" : "Leaflet + OpenStreetMap"}</div>
          <small>
            {apiKey
              ? showRadar
                ? "Radar mode uses the Leaflet engine so the live weather overlay can render."
                : "Google key detected. Turn Doppler back on any time."
              : "No Google key set yet. Using the built-in fallback map so the base stays usable."}
          </small>
        </div>

        <div className="map-sidecard">
          <strong>Live doppler</strong>
          <div>{showRadar ? "NOAA MRMS composite radar overlay is enabled." : "Radar layer is currently hidden."}</div>
          <small>
            Source: NOAA/NCEP OpenGeo WMS composite reflectivity feed. Built for a simple live weather layer in the MVP.
          </small>
        </div>

        <div className="map-sidecard">
          <strong>API / env setup</strong>
          <div>
            Add <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to <code>.env.local</code>.
          </div>
          <small>Example values are in `.env.example`. The overlay data already comes from the local API.</small>
        </div>

        <div className="map-sidecard">
          <strong>Layer filters</strong>
          <div className="filter-list">
            {(Object.keys(visibleKinds) as SourceKind[]).map((kind) => (
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
          <small>Use these checkboxes to show or hide overlay sources without changing the base map.</small>
        </div>

        <div className="map-sidecard">
          <strong>Selected overlay</strong>
          {selectedEvent ? (
            <>
              <div>{selectedEvent.summary}</div>
              <small>{formatEventMeta(selectedEvent)}</small>
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
              <small>{selectedCamera.provider} | loaded into camera viewer</small>
              <div className="selected-link-row">
                <button
                  type="button"
                  className="selected-link-button"
                  onClick={() => viewCameraOnDashboard(selectedCamera)}
                >
                  View on dashboard
                </button>
              </div>
            </>
          ) : null}
          {!selectedEvent && !selectedStack && !selectedCamera ? (
            <div>Click an event, stack, or camera marker to inspect it.</div>
          ) : null}
        </div>

        <div ref={cameraViewerCardRef} className="map-sidecard">
          <strong>Camera viewer</strong>
          {viewerCamera ? (
            <>
              <div className="camera-viewer-header">
                <div className="camera-viewer-name">{viewerCamera.name}</div>
                <small>
                  {viewerCamera.provider} | {cameraScope === "rno_airport" ? "RNO airport perimeter" : "Reno regional corridor"}
                </small>
              </div>

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
                <button
                  type="button"
                  className="camera-select-button"
                  onClick={() => viewCameraOnDashboard(viewerCamera)}
                >
                  Center on map
                </button>
              </div>

              <div className="camera-viewer-box">
                {viewerCamera.embedMode === "embed" && viewerCamera.previewUrl ? (
                  <CameraMediaViewer title={viewerCamera.name} src={viewerCamera.previewUrl} />
                ) : (
                  <div className="camera-viewer-placeholder">
                    <div className="camera-viewer-placeholder-title">Live viewer ready</div>
                    <small>
                      This source is currently link-only. When the official Nevada 511 API provides a direct image or video URL, it will render in this box automatically.
                    </small>
                  </div>
                )}
              </div>

              {!hasEmbeddedCameraFeed ? (
                <small className="camera-inline-note">
                  Live in-dashboard camera playback needs a real <code>NEVADA_511_API_KEY</code> in <code>.env.local</code> and a gateway restart.
                </small>
              ) : null}
              {cameraScope === "rno_airport" ? (
                <small className="camera-inline-note">
                  RNO airport mode shows public Nevada 511 cameras within about 5 miles of KRNO.
                </small>
              ) : null}
            </>
          ) : (
            <div>No active cameras are available in the current region and filters.</div>
          )}
        </div>
      </div>
    </div>
  );
}

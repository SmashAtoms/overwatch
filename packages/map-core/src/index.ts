import type { InformationStack, RegionConfig, SignalEvent } from "@signalstack/contracts";

export type MapMarker = {
  id: string;
  label: string;
  screenX: string;
  screenY: string;
};

export type SceneSnapshot = {
  region: RegionConfig;
  viewpoints: RegionConfig["savedViewpoints"];
  markers: MapMarker[];
  counts: {
    events: number;
    stacks: number;
  };
  layerSummary: string;
};

export interface MapSceneAdapter {
  kind: "cesium" | "mapbox";
  supportsTerrain: boolean;
  supportsAltitudeTracks: boolean;
}

export interface LayerController {
  id: string;
  label: string;
  visible: boolean;
}

export interface SelectionState {
  selectedEventId?: string;
  selectedStackId?: string;
}

export interface CameraController {
  mode: "north-up" | "orbit" | "fly-through" | "runway-snap";
}

function markerPosition(index: number): { screenX: string; screenY: string } {
  const positions = [
    { screenX: "22%", screenY: "24%" },
    { screenX: "58%", screenY: "34%" },
    { screenX: "48%", screenY: "56%" },
    { screenX: "69%", screenY: "61%" },
    { screenX: "35%", screenY: "68%" }
  ];

  return positions[index % positions.length];
}

export function createSceneSnapshot({
  region,
  viewpoints,
  events,
  stacks
}: {
  region: RegionConfig;
  viewpoints: RegionConfig["savedViewpoints"];
  events: SignalEvent[];
  stacks: InformationStack[];
}): SceneSnapshot {
  const markers = events.map((event, index) => {
    const position = markerPosition(index);
    const entity = event.entities?.[0]?.value ?? event.eventType;

    return {
      id: event.id,
      label: entity,
      ...position
    };
  });

  const distinctSources = [...new Set(events.map((event) => event.sourceType))];

  return {
    region,
    viewpoints,
    markers,
    counts: {
      events: events.length,
      stacks: stacks.length
    },
    layerSummary: distinctSources.join(" · ")
  };
}

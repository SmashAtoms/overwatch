import type { AdapterHealth, SignalEvent } from "@signalstack/contracts";
import { DEFAULT_REGION } from "@signalstack/contracts";

const OPENSKY_API_URL = "https://opensky-network.org/api/states/all";
const KRNO_LIVE_BBOX: [number, number, number, number] = [-120.05, 39.2, -119.45, 39.75];
const AIRCRAFT_CACHE_TTL_MS = 15_000;
const KNOTS_PER_MPS = 1.943844;
const FEET_PER_METER = 3.28084;

type OpenSkyState = [
  string,
  string | null,
  string | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  boolean | null,
  number | null,
  number | null,
  number | null,
  number[] | null,
  number | null,
  string | null,
  boolean | null,
  number | null,
  number | null | undefined
];

type OpenSkyResponse = {
  time: number;
  states: OpenSkyState[] | null;
};

type AircraftSnapshot = {
  fetchedAt: string;
  events: SignalEvent[];
};

type AircraftCache = {
  fetchedAtMs: number;
  snapshot: AircraftSnapshot;
  error: string | null;
};

let aircraftCache: AircraftCache | null = null;

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function looksLikeTailNumber(value: string): boolean {
  return /^N\d[A-Z0-9]{0,5}$/.test(value) || /^[A-Z]{1,2}-[A-Z0-9]{3,5}$/.test(value);
}

function buildAircraftSummary(displayId: string, state: OpenSkyState): string {
  const onGround = state[8] === true;
  const altitudeM = typeof state[13] === "number" ? state[13] : typeof state[7] === "number" ? state[7] : null;
  const altitudeFt = altitudeM !== null ? Math.round(altitudeM * FEET_PER_METER) : null;
  const speedKt = typeof state[9] === "number" ? Math.round(state[9] * KNOTS_PER_MPS) : null;

  if (onGround) {
    return `${displayId} is on the ground in the KRNO airspace box.`;
  }

  const parts = [`${displayId} is live in the Reno/KRNO airspace`];

  if (altitudeFt !== null) {
    parts.push(`at ${altitudeFt.toLocaleString()} ft`);
  }

  if (speedKt !== null) {
    parts.push(`moving ${speedKt} kt`);
  }

  return `${parts.join(" ")}.`;
}

function buildAircraftEntities(displayId: string, state: OpenSkyState) {
  const entities: SignalEvent["entities"] = [
    { kind: "icao24", value: state[0].toUpperCase(), confidence: 0.99 },
    { kind: "airport", value: "KRNO", confidence: 0.92 }
  ];

  if (looksLikeTailNumber(displayId)) {
    entities.push({ kind: "registration", value: displayId, confidence: 0.9 });
  } else {
    entities.push({ kind: "callsign", value: displayId, confidence: 0.9 });
  }

  if (state[8] === true) {
    entities.push({ kind: "trend", value: "on_ground", confidence: 0.88 });
  } else if (typeof state[11] === "number") {
    entities.push({
      kind: "trend",
      value: state[11] > 1 ? "climbing" : state[11] < -1 ? "descending" : "level",
      confidence: 0.84
    });
  }

  if (state[14]) {
    entities.push({ kind: "squawk", value: state[14], confidence: 0.86 });
  }

  return entities;
}

function stateToEvent(state: OpenSkyState, nowIso: string): SignalEvent | null {
  const lon = state[5];
  const lat = state[6];

  if (typeof lon !== "number" || typeof lat !== "number") {
    return null;
  }

  const rawIdentifier = state[1]?.trim() || state[0].toUpperCase();
  const displayIdentifier = rawIdentifier.toUpperCase();
  const altitudeM = typeof state[13] === "number" ? state[13] : typeof state[7] === "number" ? state[7] : null;
  const occurredAt =
    typeof state[4] === "number" ? new Date(state[4] * 1000).toISOString() : nowIso;

  return {
    id: `evt-aircraft-${state[0].toLowerCase()}`,
    sourceType: "aircraft",
    eventType: "track.update",
    occurredAt,
    ingestedAt: nowIso,
    point: {
      lon,
      lat,
      altM: altitudeM
    },
    confidence: state[8] === true ? 0.9 : 0.96,
    summary: buildAircraftSummary(displayIdentifier, state),
    transcript: null,
    entities: buildAircraftEntities(displayIdentifier, state),
    rawPayload: {
      provider: "opensky",
      icao24: state[0].toUpperCase(),
      callsign: displayIdentifier,
      registration: looksLikeTailNumber(displayIdentifier) ? displayIdentifier : undefined,
      originCountry: state[2] ?? undefined,
      lastContactAt: occurredAt,
      headingDeg: typeof state[10] === "number" ? round(state[10], 1) : null,
      speedKt: typeof state[9] === "number" ? round(state[9] * KNOTS_PER_MPS, 1) : null,
      verticalRateMps: typeof state[11] === "number" ? round(state[11], 1) : null,
      onGround: state[8] === true,
      squawk: state[14] ?? undefined
    }
  };
}

async function fetchOpenSkySnapshot(): Promise<AircraftSnapshot> {
  const params = new URLSearchParams({
    lamin: KRNO_LIVE_BBOX[1].toString(),
    lomin: KRNO_LIVE_BBOX[0].toString(),
    lamax: KRNO_LIVE_BBOX[3].toString(),
    lomax: KRNO_LIVE_BBOX[2].toString()
  });
  const response = await fetch(`${OPENSKY_API_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`OpenSky request failed with ${response.status}`);
  }

  const payload = (await response.json()) as OpenSkyResponse;
  const nowIso = new Date().toISOString();
  const events = (payload.states ?? [])
    .map((state) => stateToEvent(state, nowIso))
    .filter((event): event is SignalEvent => Boolean(event))
    .sort((left, right) => {
      const leftGround = left.rawPayload?.onGround === true ? 1 : 0;
      const rightGround = right.rawPayload?.onGround === true ? 1 : 0;
      if (leftGround !== rightGround) {
        return rightGround - leftGround;
      }

      return (right.point.altM ?? 0) - (left.point.altM ?? 0);
    });

  return {
    fetchedAt: payload.time ? new Date(payload.time * 1000).toISOString() : nowIso,
    events
  };
}

export async function getLiveAircraftSnapshot(options?: {
  forceRefresh?: boolean;
}): Promise<AircraftSnapshot> {
  const now = Date.now();
  if (
    !options?.forceRefresh &&
    aircraftCache &&
    now - aircraftCache.fetchedAtMs < AIRCRAFT_CACHE_TTL_MS &&
    aircraftCache.snapshot.events.length > 0
  ) {
    return aircraftCache.snapshot;
  }

  try {
    const snapshot = await fetchOpenSkySnapshot();
    aircraftCache = {
      fetchedAtMs: now,
      snapshot,
      error: null
    };
    return snapshot;
  } catch (error) {
    if (aircraftCache?.snapshot) {
      return aircraftCache.snapshot;
    }

    throw error;
  }
}

export async function getAircraftLayerHealth(): Promise<AdapterHealth> {
  try {
    const snapshot = await getLiveAircraftSnapshot();
    const lagMs = Math.max(0, Date.now() - new Date(snapshot.fetchedAt).getTime());
    return {
      adapterId: "aircraft-open-sky",
      kind: "aircraft",
      status: snapshot.events.length > 0 ? "healthy" : "degraded",
      lagMs,
      lastSuccessAt: snapshot.fetchedAt,
      coverageBbox: KRNO_LIVE_BBOX,
      policyMode: "enabled"
    };
  } catch {
    return {
      adapterId: "aircraft-open-sky",
      kind: "aircraft",
      status: "offline",
      lagMs: AIRCRAFT_CACHE_TTL_MS,
      lastSuccessAt: aircraftCache?.snapshot.fetchedAt ?? null,
      coverageBbox: KRNO_LIVE_BBOX,
      policyMode: "enabled"
    };
  }
}

export function mergeLiveAircraftIntoEvents(baseEvents: SignalEvent[], aircraftEvents: SignalEvent[]): SignalEvent[] {
  const nonAircraftEvents = baseEvents.filter((event) => event.sourceType !== "aircraft");
  return [...aircraftEvents, ...nonAircraftEvents];
}

export function getAircraftLiveBbox() {
  return KRNO_LIVE_BBOX;
}

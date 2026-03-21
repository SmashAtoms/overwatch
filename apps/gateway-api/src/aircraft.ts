import type { AdapterHealth, SignalEvent } from "@signalstack/contracts";
import { DEFAULT_REGION } from "@signalstack/contracts";

const OPENSKY_API_URL = "https://opensky-network.org/api/states/all";
const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const ADSBEXCHANGE_MIL_URL = "https://adsbexchange-com1.p.rapidapi.com/v2/mil/";
const ADSBEXCHANGE_HOST = "adsbexchange-com1.p.rapidapi.com";
const KRNO_LIVE_BBOX: [number, number, number, number] = [-120.45, 38.95, -119.1, 39.95];
const AIRCRAFT_CACHE_TTL_MS = 30_000;
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

type AdsbExchangeAircraft = {
  hex?: string;
  flight?: string | null;
  r?: string | null;
  t?: string | null;
  lat?: number | null;
  lon?: number | null;
  alt_baro?: number | string | null;
  gs?: number | null;
  track?: number | null;
  baro_rate?: number | null;
  seen?: number | null;
};

type AdsbExchangeResponse = {
  ac?: AdsbExchangeAircraft[];
  msg?: string;
  total?: number;
};

type AircraftSnapshot = {
  fetchedAt: string;
  events: SignalEvent[];
};

type ProviderSnapshot = AircraftSnapshot & {
  provider: "opensky" | "adsbexchange_military";
  priority: number;
};

type AircraftCache = {
  fetchedAtMs: number;
  snapshot: AircraftSnapshot;
  error: string | null;
};

type OpenSkyTokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let aircraftCache: AircraftCache | null = null;
let openSkyTokenCache: OpenSkyTokenCache | null = null;

const PROVIDER_PRIORITIES = {
  opensky: 20,
  adsbexchange_military: 30
} as const;

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getEventFreshnessMs(event: SignalEvent): number {
  const candidate =
    (typeof event.rawPayload?.lastContactAt === "string" ? event.rawPayload.lastContactAt : null) ??
    event.occurredAt ??
    event.ingestedAt;
  const parsed = candidate ? Date.parse(candidate) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function getEventProviderPriority(event: SignalEvent): number {
  const provider = typeof event.rawPayload?.provider === "string" ? event.rawPayload.provider : "";
  if (provider === "adsbexchange_military") {
    return PROVIDER_PRIORITIES.adsbexchange_military;
  }

  return PROVIDER_PRIORITIES.opensky;
}

function shouldReplaceAircraftRecord(current: SignalEvent, incoming: SignalEvent): boolean {
  const currentFreshnessMs = getEventFreshnessMs(current);
  const incomingFreshnessMs = getEventFreshnessMs(incoming);
  const freshnessDeltaMs = incomingFreshnessMs - currentFreshnessMs;

  if (freshnessDeltaMs > 15_000) {
    return true;
  }

  if (freshnessDeltaMs < -15_000) {
    return false;
  }

  const currentPriority = getEventProviderPriority(current);
  const incomingPriority = getEventProviderPriority(incoming);

  if (incomingPriority !== currentPriority) {
    return incomingPriority > currentPriority;
  }

  return incomingFreshnessMs >= currentFreshnessMs;
}

function getOpenSkyAuthConfig() {
  return {
    clientId: process.env.OPENSKY_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.OPENSKY_CLIENT_SECRET?.trim() ?? "",
    username: process.env.OPENSKY_USERNAME?.trim() ?? "",
    password: process.env.OPENSKY_PASSWORD?.trim() ?? ""
  };
}

async function getOpenSkyAccessToken(): Promise<string | null> {
  const { clientId, clientSecret } = getOpenSkyAuthConfig();

  if (!clientId || !clientSecret) {
    return null;
  }

  const nowMs = Date.now();
  if (openSkyTokenCache && openSkyTokenCache.expiresAtMs - nowMs > 30_000) {
    return openSkyTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(OPENSKY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error(`OpenSky token request failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error("OpenSky token response did not include access_token");
  }

  openSkyTokenCache = {
    accessToken: payload.access_token,
    expiresAtMs: nowMs + (payload.expires_in ?? 300) * 1000
  };

  return payload.access_token;
}

function getAdsbExchangeRapidApiKey(): string {
  return (
    process.env.ADSBEXCHANGE_RAPIDAPI_KEY?.trim() ??
    process.env.RAPIDAPI_AERODATABOX_KEY?.trim() ??
    ""
  );
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

function toMetersFromFeet(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value * 0.3048;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric * 0.3048;
    }
  }

  return null;
}

function militaryAircraftToEvent(item: AdsbExchangeAircraft, nowIso: string): SignalEvent | null {
  if (typeof item.lat !== "number" || typeof item.lon !== "number" || !item.hex?.trim()) {
    return null;
  }

  const displayIdentifier =
    item.flight?.trim() || item.r?.trim() || item.t?.trim() || item.hex.trim().toUpperCase();
  const altitudeM = toMetersFromFeet(item.alt_baro);
  const occurredAt =
    typeof item.seen === "number" && Number.isFinite(item.seen)
      ? new Date(Date.now() - item.seen * 1000).toISOString()
      : nowIso;
  const speedKt = typeof item.gs === "number" && Number.isFinite(item.gs) ? round(item.gs, 1) : null;
  const headingDeg =
    typeof item.track === "number" && Number.isFinite(item.track) ? round(item.track, 1) : null;
  const verticalRateMps =
    typeof item.baro_rate === "number" && Number.isFinite(item.baro_rate)
      ? round(item.baro_rate * 0.00508, 1)
      : null;
  const altitudeFt = altitudeM !== null ? Math.round(altitudeM * FEET_PER_METER) : null;
  const speedText = speedKt !== null ? ` moving ${Math.round(speedKt)} kt` : "";
  const altitudeText = altitudeFt !== null ? ` at ${altitudeFt.toLocaleString()} ft` : "";

  return {
    id: `evt-aircraft-mil-${item.hex.trim().toLowerCase()}`,
    sourceType: "aircraft",
    eventType: "track.update",
    occurredAt,
    ingestedAt: nowIso,
    point: {
      lon: item.lon,
      lat: item.lat,
      altM: altitudeM
    },
    confidence: 0.95,
    summary: `${displayIdentifier.toUpperCase()} military aircraft is live in the Reno/Tahoe airspace${altitudeText}${speedText}.`,
    transcript: null,
    entities: [
      { kind: "icao24", value: item.hex.trim().toUpperCase(), confidence: 0.99 },
      { kind: "airport", value: "KRNO", confidence: 0.8 },
      { kind: "category", value: "military", confidence: 0.97 },
      looksLikeTailNumber(displayIdentifier.toUpperCase())
        ? { kind: "registration", value: displayIdentifier.toUpperCase(), confidence: 0.88 }
        : { kind: "callsign", value: displayIdentifier.toUpperCase(), confidence: 0.88 }
    ],
    rawPayload: {
      provider: "adsbexchange_military",
      isMilitary: true,
      icao24: item.hex.trim().toUpperCase(),
      callsign: displayIdentifier.toUpperCase(),
      registration: looksLikeTailNumber(displayIdentifier.toUpperCase())
        ? displayIdentifier.toUpperCase()
        : undefined,
      lastContactAt: occurredAt,
      headingDeg,
      speedKt,
      verticalRateMps
    }
  };
}

async function fetchAdsbExchangeMilitarySnapshot(): Promise<ProviderSnapshot> {
  const apiKey = getAdsbExchangeRapidApiKey();
  if (!apiKey) {
    return {
      provider: "adsbexchange_military",
      priority: PROVIDER_PRIORITIES.adsbexchange_military,
      fetchedAt: new Date().toISOString(),
      events: []
    };
  }

  const response = await fetch(ADSBEXCHANGE_MIL_URL, {
    headers: {
      Accept: "application/json",
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": ADSBEXCHANGE_HOST
    }
  });

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return {
      provider: "adsbexchange_military",
      priority: PROVIDER_PRIORITIES.adsbexchange_military,
      fetchedAt: new Date().toISOString(),
      events: []
    };
  }

  if (!response.ok) {
    throw new Error(`ADS-B Exchange military request failed with ${response.status}`);
  }

  const payload = (await response.json()) as AdsbExchangeResponse;
  const nowIso = new Date().toISOString();

  return {
    provider: "adsbexchange_military",
    priority: PROVIDER_PRIORITIES.adsbexchange_military,
    fetchedAt: nowIso,
    events: (payload.ac ?? [])
      .map((item) => militaryAircraftToEvent(item, nowIso))
      .filter((event): event is SignalEvent => Boolean(event))
  };
}

function mergeAircraftSnapshots(snapshots: ProviderSnapshot[]): AircraftSnapshot {
  const eventMap = new Map<string, SignalEvent>();
  let fetchedAt = snapshots[0]?.fetchedAt ?? new Date().toISOString();

  snapshots.forEach((snapshot) => {
    if (new Date(snapshot.fetchedAt).getTime() > new Date(fetchedAt).getTime()) {
      fetchedAt = snapshot.fetchedAt;
    }

    snapshot.events.forEach((event) => {
      const key =
        typeof event.rawPayload?.icao24 === "string"
          ? event.rawPayload.icao24.toLowerCase()
          : event.id.toLowerCase();
      const current = eventMap.get(key);
      if (!current || shouldReplaceAircraftRecord(current, event)) {
        eventMap.set(key, event);
      }
    });
  });

  const events = [...eventMap.values()].sort((left, right) => {
    const leftMilitary = left.rawPayload?.isMilitary === true ? 1 : 0;
    const rightMilitary = right.rawPayload?.isMilitary === true ? 1 : 0;
    if (leftMilitary !== rightMilitary) {
      return rightMilitary - leftMilitary;
    }

    return (right.point.altM ?? 0) - (left.point.altM ?? 0);
  });

  return {
    fetchedAt,
    events
  };
}

async function fetchOpenSkySnapshot(): Promise<ProviderSnapshot> {
  const params = new URLSearchParams({
    lamin: KRNO_LIVE_BBOX[1].toString(),
    lomin: KRNO_LIVE_BBOX[0].toString(),
    lamax: KRNO_LIVE_BBOX[3].toString(),
    lomax: KRNO_LIVE_BBOX[2].toString()
  });
  const authConfig = getOpenSkyAuthConfig();
  const token = await getOpenSkyAccessToken();
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (authConfig.username && authConfig.password) {
    headers.Authorization = `Basic ${Buffer.from(
      `${authConfig.username}:${authConfig.password}`
    ).toString("base64")}`;
  }

  const response = await fetch(`${OPENSKY_API_URL}?${params.toString()}`, {
    headers
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
    provider: "opensky",
    priority: PROVIDER_PRIORITIES.opensky,
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
    const snapshots = await Promise.allSettled([
      fetchOpenSkySnapshot(),
      fetchAdsbExchangeMilitarySnapshot()
    ]);
    const successfulSnapshots = snapshots
      .filter((result): result is PromiseFulfilledResult<ProviderSnapshot> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((snapshot) => snapshot.events.length > 0);

    if (successfulSnapshots.length === 0) {
      throw new Error("No live aircraft providers returned data.");
    }

    const snapshot = mergeAircraftSnapshots(successfulSnapshots);
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

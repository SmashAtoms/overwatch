"use client";

import type { SignalEvent } from "@signalstack/contracts";
import {
  clamp,
  knotsToMetersPerSecond,
  lerp,
  lerpAngle,
  projectPosition
} from "./aircraft-motion";

const FADE_AFTER_MS = 15_000;
const REMOVE_AFTER_MS = 60_000;
const MAX_TRAIL_POINTS = 24;
const MIN_TRAIL_POINT_DISTANCE_DEG = 0.00035;
const MIN_TRAIL_POINT_INTERVAL_MS = 1_500;
const POSITION_EASING_PER_SECOND = 6;
const HEADING_EASING_PER_SECOND = 8;

export type AircraftTrailPoint = {
  lat: number;
  lon: number;
  altM: number | null;
  ts: string;
};

export type AircraftRenderable = {
  key: string;
  id: string;
  event: SignalEvent;
  lat: number;
  lon: number;
  altM: number | null;
  headingDeg: number;
  opacity: number;
  stale: boolean;
  trail: AircraftTrailPoint[];
};

type AircraftRecord = {
  key: string;
  id: string;
  event: SignalEvent;
  reportedLat: number;
  reportedLon: number;
  reportedAltM: number | null;
  renderLat: number;
  renderLon: number;
  renderAltM: number | null;
  headingDeg: number;
  renderHeadingDeg: number;
  velocityMps: number;
  verticalRateMps: number;
  lastUpdateMs: number;
  lastSeenAtMs: number;
  lastTrailAppendMs: number;
  stale: boolean;
  trail: AircraftTrailPoint[];
};

function getAircraftKey(event: SignalEvent): string {
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

function getHeadingDeg(event: SignalEvent): number {
  const rawHeading = event.rawPayload?.headingDeg;
  return typeof rawHeading === "number" && Number.isFinite(rawHeading) ? rawHeading : 0;
}

function getVelocityMps(event: SignalEvent): number {
  const rawSpeedKt = event.rawPayload?.speedKt;
  return typeof rawSpeedKt === "number" && Number.isFinite(rawSpeedKt)
    ? knotsToMetersPerSecond(rawSpeedKt)
    : 0;
}

function getVerticalRateMps(event: SignalEvent): number {
  const rawVerticalRate = event.rawPayload?.verticalRateMps;
  return typeof rawVerticalRate === "number" && Number.isFinite(rawVerticalRate) ? rawVerticalRate : 0;
}

function getEventTimestampMs(event: SignalEvent, fallbackMs: number): number {
  const rawUpdate =
    (typeof event.rawPayload?.lastContactAt === "string" ? event.rawPayload.lastContactAt : null) ??
    event.ingestedAt ??
    event.occurredAt;
  const parsed = rawUpdate ? Date.parse(rawUpdate) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function shouldAppendTrailPoint(record: AircraftRecord, nextPoint: AircraftTrailPoint, updateMs: number): boolean {
  const lastPoint = record.trail[record.trail.length - 1];
  if (!lastPoint) {
    return true;
  }

  const deltaLat = Math.abs(lastPoint.lat - nextPoint.lat);
  const deltaLon = Math.abs(lastPoint.lon - nextPoint.lon);
  const farEnough = deltaLat > MIN_TRAIL_POINT_DISTANCE_DEG || deltaLon > MIN_TRAIL_POINT_DISTANCE_DEG;
  const enoughTimePassed = updateMs - record.lastTrailAppendMs >= MIN_TRAIL_POINT_INTERVAL_MS;

  return farEnough || enoughTimePassed;
}

function opacityForAge(ageMs: number): number {
  if (ageMs <= FADE_AFTER_MS) {
    return 1;
  }

  if (ageMs >= REMOVE_AFTER_MS) {
    return 0;
  }

  return clamp(1 - (ageMs - FADE_AFTER_MS) / (REMOVE_AFTER_MS - FADE_AFTER_MS), 0, 1);
}

export class AircraftStore {
  private records = new Map<string, AircraftRecord>();
  private renderables: AircraftRenderable[] = [];
  private lastFrameMs: number | null = null;

  seed(events: SignalEvent[], nowMs = Date.now()) {
    this.records.clear();
    this.lastFrameMs = nowMs;
    this.updateFromEvents(events, nowMs);
    this.tick(nowMs);
  }

  updateFromEvents(events: SignalEvent[], nowMs = Date.now()) {
    const aircraftEvents = events.filter((event) => event.sourceType === "aircraft");
    const seenKeys = new Set<string>();

    aircraftEvents.forEach((event) => {
      const key = getAircraftKey(event);
      const updateMs = getEventTimestampMs(event, nowMs);
      const headingDeg = getHeadingDeg(event);
      const velocityMps = getVelocityMps(event);
      const verticalRateMps = getVerticalRateMps(event);
      const nextPoint: AircraftTrailPoint = {
        lat: event.point.lat,
        lon: event.point.lon,
        altM: event.point.altM ?? null,
        ts: event.occurredAt
      };
      const existing = this.records.get(key);

      seenKeys.add(key);

      if (!existing) {
        this.records.set(key, {
          key,
          id: event.id,
          event,
          reportedLat: event.point.lat,
          reportedLon: event.point.lon,
          reportedAltM: event.point.altM ?? null,
          renderLat: event.point.lat,
          renderLon: event.point.lon,
          renderAltM: event.point.altM ?? null,
          headingDeg,
          renderHeadingDeg: headingDeg,
          velocityMps,
          verticalRateMps,
          lastUpdateMs: updateMs,
          lastSeenAtMs: nowMs,
          lastTrailAppendMs: updateMs,
          stale: false,
          trail: [nextPoint]
        });
        return;
      }

      existing.id = event.id;
      existing.event = event;
      existing.reportedLat = event.point.lat;
      existing.reportedLon = event.point.lon;
      existing.reportedAltM = event.point.altM ?? null;
      existing.headingDeg = headingDeg;
      existing.velocityMps = velocityMps;
      existing.verticalRateMps = verticalRateMps;
      existing.lastUpdateMs = updateMs;
      existing.lastSeenAtMs = nowMs;
      existing.stale = false;

      if (shouldAppendTrailPoint(existing, nextPoint, updateMs)) {
        existing.trail = [...existing.trail, nextPoint].slice(-MAX_TRAIL_POINTS);
        existing.lastTrailAppendMs = updateMs;
      }
    });

    this.records.forEach((record, key) => {
      if (!seenKeys.has(key)) {
        record.stale = true;
      }
    });
  }

  tick(nowMs = performance.now()): AircraftRenderable[] {
    const previousFrameMs = this.lastFrameMs ?? nowMs;
    const deltaSeconds = clamp((nowMs - previousFrameMs) / 1000, 0, 1);
    this.lastFrameMs = nowMs;

    const nextRenderables: AircraftRenderable[] = [];

    this.records.forEach((record, key) => {
      const ageSeconds = Math.max(0, (nowMs - record.lastUpdateMs) / 1000);
      const ageMs = Math.max(0, nowMs - record.lastSeenAtMs);

      if (ageMs >= REMOVE_AFTER_MS) {
        this.records.delete(key);
        return;
      }

      const predictedPosition = projectPosition(
        {
          lat: record.reportedLat,
          lon: record.reportedLon
        },
        record.velocityMps,
        record.headingDeg,
        ageSeconds
      );
      const predictedAltM =
        record.reportedAltM !== null ? record.reportedAltM + record.verticalRateMps * ageSeconds : null;
      const positionAlpha = clamp(deltaSeconds * POSITION_EASING_PER_SECOND, 0, 1);
      const headingAlpha = clamp(deltaSeconds * HEADING_EASING_PER_SECOND, 0, 1);

      record.renderLat = lerp(record.renderLat, predictedPosition.lat, positionAlpha);
      record.renderLon = lerp(record.renderLon, predictedPosition.lon, positionAlpha);
      record.renderAltM =
        record.renderAltM !== null && predictedAltM !== null
          ? lerp(record.renderAltM, predictedAltM, positionAlpha)
          : predictedAltM;
      record.renderHeadingDeg = lerpAngle(record.renderHeadingDeg, record.headingDeg, headingAlpha);

      nextRenderables.push({
        key,
        id: record.id,
        event: {
          ...record.event,
          point: {
            ...record.event.point,
            lat: record.renderLat,
            lon: record.renderLon,
            altM: record.renderAltM
          },
          rawPayload: {
            ...record.event.rawPayload,
            headingDeg: record.renderHeadingDeg
          }
        },
        lat: record.renderLat,
        lon: record.renderLon,
        altM: record.renderAltM,
        headingDeg: record.renderHeadingDeg,
        opacity: opacityForAge(ageMs),
        stale: record.stale,
        trail: record.trail
      });
    });

    this.renderables = nextRenderables;
    return nextRenderables;
  }

  getRenderables(): AircraftRenderable[] {
    return this.renderables;
  }
}

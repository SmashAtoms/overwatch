"use client";

const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_SECOND_PER_KNOT = 0.514444;

export type LatLonPoint = {
  lat: number;
  lon: number;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export function normalizeHeading(headingDeg: number): number {
  const normalized = headingDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function lerpAngle(fromDeg: number, toDeg: number, alpha: number): number {
  const start = normalizeHeading(fromDeg);
  const end = normalizeHeading(toDeg);
  let delta = end - start;

  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }

  return normalizeHeading(start + delta * alpha);
}

export function knotsToMetersPerSecond(knots: number | null | undefined): number {
  return typeof knots === "number" ? knots * METERS_PER_SECOND_PER_KNOT : 0;
}

export function projectPosition(
  point: LatLonPoint,
  speedMetersPerSecond: number,
  headingDeg: number,
  deltaSeconds: number
): LatLonPoint {
  if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond <= 0 || deltaSeconds <= 0) {
    return point;
  }

  const headingRad = (normalizeHeading(headingDeg) * Math.PI) / 180;
  const distanceMeters = speedMetersPerSecond * deltaSeconds;
  const latRad = (point.lat * Math.PI) / 180;
  const lonRad = (point.lon * Math.PI) / 180;
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;

  const nextLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(headingRad)
  );
  const nextLonRad =
    lonRad +
    Math.atan2(
      Math.sin(headingRad) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(nextLatRad)
    );

  return {
    lat: (nextLatRad * 180) / Math.PI,
    lon: ((nextLonRad * 180) / Math.PI + 540) % 360 - 180
  };
}

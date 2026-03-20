import { DEFAULT_REGION } from "@signalstack/contracts";

export const REGION_ID = DEFAULT_REGION.id;

export const AIRSPACE_ZONES = [
  {
    id: "krno-primary",
    name: "KRNO Primary",
    bbox: [-119.83, 39.44, -119.68, 39.56] as [number, number, number, number]
  },
  {
    id: "reno-west-weather-watch",
    name: "Reno West Weather Watch",
    bbox: [-120.05, 39.46, -119.78, 39.71] as [number, number, number, number]
  }
];

export const CAMERA_POLICY_NOTES = [
  "Use embedding only when provider terms allow it.",
  "Prefer link-out for public traffic camera programs with recording restrictions."
];

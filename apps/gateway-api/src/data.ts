import {
  DEFAULT_REGION,
  type AdapterHealth,
  type CameraSource,
  type InformationStack,
  type ReplayFrameSet,
  type SignalEvent
} from "@signalstack/contracts";

const now = new Date();

function minutesAgo(minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

export const adapterHealth: AdapterHealth[] = [
  {
    adapterId: "aircraft-open-sky",
    kind: "aircraft",
    status: "healthy",
    lagMs: 6500,
    lastSuccessAt: minutesAgo(1),
    coverageBbox: DEFAULT_REGION.bbox,
    policyMode: "enabled"
  },
  {
    adapterId: "weather-nws",
    kind: "weather",
    status: "healthy",
    lagMs: 12000,
    lastSuccessAt: minutesAgo(1),
    coverageBbox: DEFAULT_REGION.bbox,
    policyMode: "enabled"
  },
  {
    adapterId: "atc-authorized",
    kind: "atc",
    status: "degraded",
    lagMs: 48000,
    lastSuccessAt: minutesAgo(3),
    coverageBbox: DEFAULT_REGION.bbox,
    policyMode: "delayed"
  },
  {
    adapterId: "scanner-authorized",
    kind: "scanner",
    status: "restricted",
    lagMs: 94000,
    lastSuccessAt: minutesAgo(5),
    coverageBbox: DEFAULT_REGION.bbox,
    policyMode: "delayed"
  },
  {
    adapterId: "camera-catalog",
    kind: "camera",
    status: "healthy",
    lagMs: 18000,
    lastSuccessAt: minutesAgo(2),
    coverageBbox: DEFAULT_REGION.bbox,
    policyMode: "link_only"
  }
];

export const events: SignalEvent[] = [
  {
    id: "evt-aircraft-swa4437",
    sourceType: "aircraft",
    eventType: "track.update",
    occurredAt: minutesAgo(1),
    ingestedAt: minutesAgo(1),
    point: { lon: -119.7682, lat: 39.5091, altM: 2870 },
    confidence: 0.96,
    summary: "SWA4437 is descending toward KRNO with weather cells to the west.",
    transcript: null,
    entities: [
      { kind: "registration", value: "N443SW", confidence: 0.96 },
      { kind: "callsign", value: "SWA4437", confidence: 0.99 },
      { kind: "airport", value: "KRNO", confidence: 0.98 },
      { kind: "trend", value: "descending", confidence: 0.94 }
    ],
    rawPayload: {
      headingDeg: 128,
      speedKt: 212,
      origin: "KLAS",
      destination: "KRNO",
      registration: "N443SW",
      callsign: "SWA4437"
    }
  },
  {
    id: "evt-atc-118700-1",
    sourceType: "atc",
    eventType: "transcript.segment",
    occurredAt: minutesAgo(2),
    ingestedAt: minutesAgo(2),
    point: { lon: -119.7674, lat: 39.4993, altM: 1347 },
    confidence: 0.81,
    summary: "Tower appears to clear Southwest 4437 to continue approach for runway 17R.",
    transcript: {
      channel: "Reno Tower 118.700",
      rawText: "southwest forty four thirty seven roger continue approach runway one seven right wind one eight zero at one two",
      cleanText: "Southwest 4437, continue approach runway 17R, wind 180 at 12.",
      speakerLabel: "tower",
      language: "en",
      startMs: 0,
      endMs: 4200,
      modelConfidence: 0.82,
      ruleConfidence: 0.9
    },
    entities: [
      { kind: "callsign", value: "SWA4437", confidence: 0.93 },
      { kind: "runway", value: "17R", confidence: 0.9 },
      { kind: "frequency", value: "118.700", confidence: 0.97 }
    ],
    rawPayload: {
      position: "tower",
      clearanceType: "approach"
    }
  },
  {
    id: "evt-scanner-rfd-1",
    sourceType: "scanner",
    eventType: "incident.thread",
    occurredAt: minutesAgo(4),
    ingestedAt: minutesAgo(4),
    point: { lon: -119.8138, lat: 39.5296, altM: null },
    confidence: 0.62,
    summary: "Possible vehicle fire dispatch near I-80 and Vista with one engine en route.",
    transcript: {
      channel: "Regional Fire Dispatch",
      rawText: "engine six copy possible vehicle fire eastbound eighty at vista unknown injuries",
      cleanText: "Engine 6 copies a possible vehicle fire eastbound I-80 at Vista. Injuries unknown.",
      speakerLabel: "dispatch",
      language: "en",
      startMs: 0,
      endMs: 3800,
      modelConfidence: 0.68,
      ruleConfidence: 0.7
    },
    entities: [
      { kind: "unit", value: "Engine 6", confidence: 0.86 },
      { kind: "incident_type", value: "vehicle fire", confidence: 0.79 },
      { kind: "location", value: "I-80 and Vista", confidence: 0.64 }
    ],
    rawPayload: {
      agency: "Regional Fire",
      priority: "high"
    }
  },
  {
    id: "evt-weather-cell-1",
    sourceType: "weather",
    eventType: "weather.frame",
    occurredAt: minutesAgo(1),
    ingestedAt: minutesAgo(1),
    point: { lon: -119.912, lat: 39.62, altM: 2200 },
    confidence: 0.89,
    summary: "Moderate precipitation cell moving east toward the western edge of the Reno basin.",
    transcript: null,
    entities: [
      { kind: "weather", value: "moderate precipitation", confidence: 0.9 },
      { kind: "movement", value: "east", confidence: 0.81 }
    ],
    rawPayload: {
      severity: "moderate",
      frameId: "nws-radar-2026-03-20T07:59:00Z"
    }
  },
  {
    id: "evt-camera-ndot-1",
    sourceType: "camera",
    eventType: "camera.available",
    occurredAt: minutesAgo(6),
    ingestedAt: minutesAgo(6),
    point: { lon: -119.7967, lat: 39.5164, altM: null },
    confidence: 0.92,
    summary: "NDOT camera available near I-580 and Moana with link-out policy.",
    transcript: null,
    entities: [
      { kind: "camera", value: "NDOT I-580 / Moana", confidence: 0.95 }
    ],
    rawPayload: {
      embedMode: "link_only",
      provider: "NDOT"
    }
  }
];

export const stacks: InformationStack[] = [
  {
    id: "stack-krno-arrival-1",
    title: "KRNO arrival with approach clearance and weather context",
    status: "live",
    timeWindow: {
      start: minutesAgo(3),
      end: minutesAgo(1)
    },
    centroid: { lon: -119.7678, lat: 39.5058, altM: 2300 },
    sources: ["aircraft", "atc", "weather"],
    entities: [
      { kind: "callsign", value: "SWA4437", confidence: 0.93 },
      { kind: "runway", value: "17R", confidence: 0.9 },
      { kind: "weather", value: "moderate precipitation", confidence: 0.88 }
    ],
    confidence: 0.88,
    summary: "Aircraft descent, tower traffic, and weather radar align on a KRNO arrival.",
    plainEnglish:
      "Southwest 4437 appears to be continuing into Reno on runway 17R while a precipitation band approaches from the west.",
    mapJump: {
      bbox: [-119.95, 39.44, -119.62, 39.61]
    },
    evidence: [
      { sourceType: "aircraft", sourceId: "evt-aircraft-swa4437", reason: "same callsign", weight: 0.96 },
      { sourceType: "atc", sourceId: "evt-atc-118700-1", reason: "tower clearance", weight: 0.88 },
      { sourceType: "weather", sourceId: "evt-weather-cell-1", reason: "spatial overlap", weight: 0.75 }
    ],
    policy: {
      delayed: false,
      restricted: false,
      notes: ["Authorized or public data only", "Raw transcript retained beside summary"]
    }
  },
  {
    id: "stack-vista-fire-1",
    title: "Vista corridor fire dispatch with camera context",
    status: "recent",
    timeWindow: {
      start: minutesAgo(7),
      end: minutesAgo(3)
    },
    centroid: { lon: -119.8075, lat: 39.523, altM: null },
    sources: ["scanner", "camera", "weather"],
    entities: [
      { kind: "incident_type", value: "vehicle fire", confidence: 0.79 },
      { kind: "camera", value: "NDOT I-580 / Moana", confidence: 0.7 }
    ],
    confidence: 0.69,
    summary: "Dispatch traffic and a nearby camera source suggest an unfolding roadside incident.",
    plainEnglish:
      "A likely vehicle fire was dispatched near Vista. The nearest allowed camera source is available by link-out.",
    mapJump: {
      bbox: [-119.88, 39.48, -119.73, 39.57]
    },
    evidence: [
      { sourceType: "scanner", sourceId: "evt-scanner-rfd-1", reason: "incident origin", weight: 0.79 },
      { sourceType: "camera", sourceId: "evt-camera-ndot-1", reason: "nearby view", weight: 0.58 }
    ],
    policy: {
      delayed: true,
      restricted: true,
      notes: ["Scanner-derived content is delayed and confidence limited"]
    }
  }
];

export const cameras: CameraSource[] = [
  {
    id: "cam-virginia-city-skyline",
    name: "Virginia City C Street Camera",
    provider: "SkylineWebcams",
    point: { lon: -119.6496, lat: 39.3097 },
    embedMode: "embed",
    targetUrl: "https://www.skylinewebcams.com/en/webcam/united-states/nevada/virginia-city/virginia-city.html",
    previewUrl: "https://embed.skylinewebcams.com/img/1130.jpg",
    status: "active"
  },
  {
    id: "cam-reno-arch-youtube",
    name: "Reno Arch Camera",
    provider: "City of Reno YouTube Live",
    point: { lon: -119.8136, lat: 39.5285 },
    embedMode: "embed",
    targetUrl: "https://www.youtube.com/watch?v=laopqyiYlxg",
    previewUrl:
      "https://www.youtube.com/embed/laopqyiYlxg?autoplay=1&mute=1&playsinline=1&rel=0",
    status: "active"
  },
  {
    id: "cam-reno-city-plaza-youtube",
    name: "City Plaza Camera",
    provider: "City of Reno YouTube Live",
    point: { lon: -119.8133, lat: 39.5256 },
    embedMode: "embed",
    targetUrl: "https://www.youtube.com/watch?v=Aea4taIIVPE",
    previewUrl:
      "https://www.youtube.com/embed/Aea4taIIVPE?autoplay=1&mute=1&playsinline=1&rel=0",
    status: "active"
  },
  {
    id: "cam-reno-greater-nevada-field-youtube",
    name: "Greater Nevada Field Camera",
    provider: "City of Reno YouTube Live",
    point: { lon: -119.8057, lat: 39.5274 },
    embedMode: "embed",
    targetUrl: "https://www.youtube.com/watch?v=V-ERTb6JXrc",
    previewUrl:
      "https://www.youtube.com/embed/V-ERTb6JXrc?autoplay=1&mute=1&playsinline=1&rel=0",
    status: "active"
  },
  {
    id: "cam-tahoe-airport-youtube",
    name: "South Lake Tahoe Airport",
    provider: "YouTube Live",
    point: { lon: -119.9953, lat: 38.8939 },
    embedMode: "embed",
    targetUrl: "https://www.youtube.com/watch?v=Gq1kM9PqNg4",
    previewUrl:
      "https://www.youtube.com/embed/Gq1kM9PqNg4?autoplay=1&mute=1&playsinline=1&rel=0",
    status: "active"
  },
  {
    id: "cam-unr-quad-youtube",
    name: "UNR Quad Camera",
    provider: "YouTube Live",
    point: { lon: -119.8154, lat: 39.5454 },
    embedMode: "embed",
    targetUrl: "https://www.youtube.com/watch?v=5vsOc_X2XKA",
    previewUrl:
      "https://www.youtube.com/embed/5vsOc_X2XKA?autoplay=1&mute=1&playsinline=1&rel=0",
    status: "active"
  },
  {
    id: "cam-sparks-water-bar-hdontap",
    name: "Sparks Water Bar",
    provider: "HDOnTap",
    point: { lon: -119.727747, lat: 39.535305 },
    embedMode: "embed",
    targetUrl: "https://hdontap.com/stream/279332/sparks-water-bar-live-webcam/",
    previewUrl: "https://hdontap.com/stream/279332/sparks-water-bar-live-webcam/embed/",
    status: "active"
  },
  {
    id: "cam-youtube-i8jnfsoopjg",
    name: "Reno Union Pacific",
    provider: "YouTube Live",
    point: { lon: -119.8138, lat: 39.5296 },
    embedMode: "embed",
    targetUrl: "https://www.youtube.com/watch?v=i8jNfsoOpJg",
    previewUrl:
      "https://www.youtube.com/embed/i8jNfsoOpJg?autoplay=1&mute=1&playsinline=1&rel=0",
    status: "active"
  },
  {
    id: "cam-news4-greater-nevada-field",
    name: "Greater Nevada Field - Bradley Drendel & Jeanney",
    provider: "MyNews4 SkyCam",
    point: { lon: -119.8057, lat: 39.5274 },
    embedMode: "embed",
    targetUrl: "https://mynews4.com/weather/skycam",
    previewUrl:
      "https://sinclairstoryline.com/resources/video/players/prod/src/scripts/v1/dist/embed.html?file=https%3A%2F%2Fd237lhmlzpreh2.cloudfront.net%2FNSN%2FNevfield%2Fm3u8%2FNSN-Nevfield_live.m3u8%3Fresize%3Dtrue&autostart=true&sync=false&advertising=false",
    status: "active"
  },
  {
    id: "cam-news4-legends-bay-casino",
    name: "Legends Bay Casino",
    provider: "MyNews4 SkyCam",
    point: { lon: -119.7195, lat: 39.5289 },
    embedMode: "embed",
    targetUrl: "https://mynews4.com/weather/skycam",
    previewUrl:
      "https://sinclairstoryline.com/resources/video/players/prod/src/scripts/v1/dist/embed.html?file=https%3A%2F%2Fd237lhmlzpreh2.cloudfront.net%2FNSN%2FBayCasino%2Fm3u8%2FNSN-BayCasino_live.m3u8%3Fresize%3Dtrue&autostart=true&sync=false&advertising=false",
    status: "active"
  },
  {
    id: "cam-news4-fox11-skycam",
    name: "News4/Fox11 Skycam",
    provider: "MyNews4 SkyCam",
    point: { lon: -119.8138, lat: 39.5296 },
    embedMode: "embed",
    targetUrl: "https://mynews4.com/weather/skycam",
    previewUrl:
      "https://sinclairstoryline.com/resources/video/players/prod/src/scripts/v1/dist/embed.html?file=https%3A%2F%2Fd237lhmlzpreh2.cloudfront.net%2FNSN%2FInternetAuto%2Fm3u8%2FNSN-InternetAuto_live.m3u8%3Fresize%3Dtrue&autostart=true&sync=false&advertising=false",
    status: "active"
  },
  {
    id: "cam-news4-porsche-reno",
    name: "Porsche Reno Skycam",
    provider: "MyNews4 SkyCam",
    point: { lon: -119.7786, lat: 39.5164 },
    embedMode: "embed",
    targetUrl: "https://mynews4.com/weather/skycam",
    previewUrl:
      "https://sinclairstoryline.com/resources/video/players/prod/src/scripts/v1/dist/embed.html?file=https%3A%2F%2Fd237lhmlzpreh2.cloudfront.net%2FNSN%2FPorscheReno%2Fm3u8%2FNSN-PorscheReno_live.m3u8%3Fresize%3Dtrue&autostart=true&sync=false&advertising=false",
    status: "active"
  },
  {
    id: "cam-news4-university-nevada-skycam",
    name: "University of Nevada Skycam",
    provider: "MyNews4 SkyCam",
    point: { lon: -119.8154, lat: 39.5454 },
    embedMode: "embed",
    targetUrl: "https://mynews4.com/weather/skycam",
    previewUrl:
      "https://sinclairstoryline.com/resources/video/players/prod/src/scripts/v1/dist/embed.html?file=https%3A%2F%2Fd237lhmlzpreh2.cloudfront.net%2FNSN%2FUNSkycam%2Fm3u8%2FNSN-UNSkycam_live.m3u8%3Fresize%3Dtrue&autostart=true&sync=false&advertising=false",
    status: "active"
  },
  {
    id: "cam-youtube-rsd2aav6w8",
    name: "Reno Live YouTube Cam",
    provider: "YouTube Live",
    point: { lon: -119.8138, lat: 39.5296 },
    embedMode: "embed",
    targetUrl: "https://www.youtube.com/live/RSd2aaV-6w8?si=5V-4yopUvnXePnkW",
    previewUrl:
      "https://www.youtube.com/embed/RSd2aaV-6w8?autoplay=1&mute=1&playsinline=1&rel=0",
    status: "active"
  },
  {
    id: "cam-ndot-plumb-airport",
    name: "Nevada 511 I-580 @ Plumb Airport",
    provider: "Nevada 511",
    point: { lon: -119.7814, lat: 39.5031 },
    embedMode: "link_only",
    targetUrl: "https://www.nvroads.com/region/Reno",
    previewUrl: null,
    status: "active"
  },
  {
    id: "cam-ndot-mill-st",
    name: "Nevada 511 I-580 @ Mill St",
    provider: "Nevada 511",
    point: { lon: -119.7828, lat: 39.5197 },
    embedMode: "link_only",
    targetUrl: "https://www.nvroads.com/region/Reno",
    previewUrl: null,
    status: "active"
  },
  {
    id: "cam-ndot-villanova",
    name: "Nevada 511 I-580 @ Villanova On Ramp",
    provider: "Nevada 511",
    point: { lon: -119.78, lat: 39.5099 },
    embedMode: "link_only",
    targetUrl: "https://www.nvroads.com/region/Reno",
    previewUrl: null,
    status: "active"
  },
  {
    id: "cam-ndot-vista",
    name: "Nevada 511 I-80 @ Vista Blvd",
    provider: "Nevada 511",
    point: { lon: -119.7002, lat: 39.5264 },
    embedMode: "link_only",
    targetUrl: "https://www.nvroads.com/region/Reno",
    previewUrl: null,
    status: "active"
  },
  {
    id: "cam-ndot-keystone",
    name: "Nevada 511 I-80 @ Keystone Ave",
    provider: "Nevada 511",
    point: { lon: -119.8296, lat: 39.5302 },
    embedMode: "link_only",
    targetUrl: "https://www.nvroads.com/region/Reno",
    previewUrl: null,
    status: "active"
  },
  {
    id: "cam-ndot-wells",
    name: "Nevada 511 I-80 @ Wells Ave",
    provider: "Nevada 511",
    point: { lon: -119.8012, lat: 39.5362 },
    embedMode: "link_only",
    targetUrl: "https://www.nvroads.com/region/Reno",
    previewUrl: null,
    status: "active"
  },
  {
    id: "cam-ndot-rock",
    name: "Nevada 511 I-80 @ Rock Blvd",
    provider: "Nevada 511",
    point: { lon: -119.7653, lat: 39.5335 },
    embedMode: "link_only",
    targetUrl: "https://www.nvroads.com/region/Reno",
    previewUrl: null,
    status: "active"
  },
  {
    id: "cam-ndot-virginia",
    name: "Nevada 511 US-395 @ S Virginia",
    provider: "Nevada 511",
    point: { lon: -119.7896, lat: 39.4726 },
    embedMode: "link_only",
    targetUrl: "https://www.nvroads.com/region/Reno",
    previewUrl: null,
    status: "active"
  },
  {
    id: "cam-carson-city-airport-spotcameras",
    name: "Carson City Airport",
    provider: "Brownrice",
    point: { lon: -119.7346, lat: 39.1929 },
    embedMode: "embed",
    targetUrl: "https://weathercams.faa.gov/map/-119.95162,39.02213,-119.07272,39.35847/station/KCXP/details/camera/13049/loop",
    previewUrl: "https://live3.brownrice.com:444/mountainwestcxp/mountainwestcxp.stream/main_playlist.m3u8",
    status: "active"
  }
];

export const replay: ReplayFrameSet = {
  range: "1h",
  generatedAt: now.toISOString(),
  frames: Array.from({ length: 8 }, (_, index) => {
    const offset = 7 - index;
    return {
      ts: minutesAgo(offset * 5),
      cursor: `frame-${index}`,
      counts: {
        events: Math.max(2, 4 + index),
        stacks: Math.max(1, 1 + Math.round(index / 2))
      }
    };
  })
};

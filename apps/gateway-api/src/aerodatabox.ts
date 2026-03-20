const AERODATABOX_HOST = "aerodatabox.p.rapidapi.com";
const MAX_WEBHOOK_EVENTS = 50;

export type FlightByNumberSubscriptionOptions = {
  flightNumber: string;
  webhookUrl: string;
  useCredits?: boolean;
  maxDeliveryRetries?: number;
};

export type RecordedWebhookEvent = {
  id: string;
  receivedAt: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  payload: unknown;
};

export type FlightSubscriptionRecord = {
  id: string;
  flightNumber: string;
  webhookUrl: string;
  useCredits: boolean;
  maxDeliveryRetries: number;
  createdAt: string;
  lastResponseStatus: number;
  lastResponseBody: unknown;
};

const webhookEvents: RecordedWebhookEvent[] = [];
const flightSubscriptions: FlightSubscriptionRecord[] = [];

export function getAeroDataBoxConfig() {
  const apiKey = process.env.RAPIDAPI_AERODATABOX_KEY ?? null;
  const publicWebhookBaseUrl = process.env.PUBLIC_WEBHOOK_BASE_URL ?? null;

  return {
    apiKey,
    publicWebhookBaseUrl,
    host: AERODATABOX_HOST
  };
}

export function buildFlightByNumberWebhookUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/v1/webhooks/aerodatabox/flight-by-number`;
}

export function recordWebhookEvent(input: {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  payload: unknown;
}) {
  webhookEvents.unshift({
    id: `adb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    path: input.path,
    headers: input.headers,
    payload: input.payload
  });

  if (webhookEvents.length > MAX_WEBHOOK_EVENTS) {
    webhookEvents.length = MAX_WEBHOOK_EVENTS;
  }
}

export function listWebhookEvents(limit = 20) {
  return webhookEvents.slice(0, Math.max(1, Math.min(limit, MAX_WEBHOOK_EVENTS)));
}

export function listFlightSubscriptions() {
  return flightSubscriptions;
}

export async function subscribeToFlightByNumber(options: FlightByNumberSubscriptionOptions) {
  const { apiKey, host } = getAeroDataBoxConfig();

  if (!apiKey) {
    throw new Error("RAPIDAPI_AERODATABOX_KEY is not configured.");
  }

  const useCredits = options.useCredits ?? false;
  const maxDeliveryRetries = options.maxDeliveryRetries ?? 0;
  const requestUrl = `https://${host}/subscriptions/webhook/FlightByNumber/${encodeURIComponent(options.flightNumber)}?useCredits=${useCredits ? "true" : "false"}`;

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": host,
      "x-rapidapi-key": apiKey
    },
    body: JSON.stringify({
      url: options.webhookUrl,
      maxDeliveryRetries
    })
  });

  const rawText = await response.text();
  let parsedBody: unknown = rawText;

  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsedBody = rawText;
  }

  if (!response.ok) {
    throw new Error(
      `AeroDataBox subscription failed with ${response.status}: ${
        typeof parsedBody === "string" ? parsedBody : JSON.stringify(parsedBody)
      }`
    );
  }

  return {
    requestUrl,
    status: response.status,
    body: parsedBody
  };
}

export function recordFlightSubscription(input: {
  flightNumber: string;
  webhookUrl: string;
  useCredits: boolean;
  maxDeliveryRetries: number;
  responseStatus: number;
  responseBody: unknown;
}) {
  const existingIndex = flightSubscriptions.findIndex(
    (item) => item.flightNumber.toUpperCase() === input.flightNumber.toUpperCase()
  );
  const record: FlightSubscriptionRecord = {
    id: `adb-sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    flightNumber: input.flightNumber.toUpperCase(),
    webhookUrl: input.webhookUrl,
    useCredits: input.useCredits,
    maxDeliveryRetries: input.maxDeliveryRetries,
    createdAt: new Date().toISOString(),
    lastResponseStatus: input.responseStatus,
    lastResponseBody: input.responseBody
  };

  if (existingIndex >= 0) {
    flightSubscriptions.splice(existingIndex, 1, record);
    return record;
  }

  flightSubscriptions.unshift(record);
  return record;
}

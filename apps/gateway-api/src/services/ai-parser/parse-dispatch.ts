import type { DispatchParseResult, DispatchPriority } from "@signalstack/contracts";

const INCIDENT_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: "FIRE", regex: /\b(fire|smoke|structure fire|vehicle fire|brush fire)\b/i },
  { type: "MEDICAL", regex: /\b(medical|cardiac|unconscious|injury|overdose|ems)\b/i },
  { type: "TRAFFIC STOP", regex: /\b(traffic stop|10-38|plate check)\b/i },
  { type: "PURSUIT", regex: /\b(pursuit|fleeing|evading)\b/i },
  { type: "DISTURBANCE", regex: /\b(disturbance|fight|assault)\b/i }
];

const PRIORITY_PATTERNS: Array<{ priority: DispatchPriority; regex: RegExp }> = [
  { priority: "high", regex: /\b(code\s*3|priority\s*1|shots fired|officer needs assistance)\b/i },
  { priority: "medium", regex: /\b(priority\s*2|urgent|expedite)\b/i },
  { priority: "low", regex: /\b(priority\s*3|routine|code\s*4)\b/i }
];

const UNIT_PATTERN =
  /\b((engine|medic|squad|rescue|air|flight|unit|adam|charlie|lincoln)\s*-?\s*\d{1,3})\b/gi;
const ADDRESS_PATTERN = /\b\d{2,6}\s+[A-Za-z0-9.\- ]+\s(?:st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive)\b/i;
const CROSS_STREET_PATTERN = /\b(?:at|near|x)\s+([A-Za-z0-9.\- ]+\s+(?:and|&)\s+[A-Za-z0-9.\- ]+)/i;

function toTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

type ParseDispatchFallbackConfig = {
  apiKey: string | null;
  model: string;
  confidenceThreshold: number;
};

function parseDispatchRuleFirst(text: string): DispatchParseResult {
  const normalized = text.trim();
  const incident = INCIDENT_PATTERNS.find((pattern) => pattern.regex.test(normalized));
  const priority = PRIORITY_PATTERNS.find((pattern) => pattern.regex.test(normalized))?.priority ?? "medium";

  const units = unique(
    Array.from(normalized.matchAll(UNIT_PATTERN)).map((match) => toTitle(match[1] ?? "")).filter(Boolean)
  );

  const addressMatch = normalized.match(ADDRESS_PATTERN)?.[0];
  const crossStreetMatch = normalized.match(CROSS_STREET_PATTERN)?.[1];
  const location = toTitle(addressMatch ?? crossStreetMatch ?? "Reno service area");
  const type = incident?.type ?? "DISPATCH";

  const tags = unique([
    type,
    priority.toUpperCase(),
    ...units.map((unit) => unit.toUpperCase()),
    location.toUpperCase()
  ]);

  const summary = `${toTitle(type)} reported near ${location}. Units ${units.length > 0 ? units.join(", ") : "pending assignment"} responding.`;
  const confidence = incident ? 0.82 : 0.58;

  return {
    type,
    location,
    priority,
    units,
    summary,
    tags,
    confidence
  };
}

function normalizePriority(value: string | undefined): DispatchPriority {
  const normalized = (value ?? "").toLowerCase().trim();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function sanitizeFallbackResult(
  candidate: Partial<DispatchParseResult> | null | undefined,
  fallback: DispatchParseResult
): DispatchParseResult {
  if (!candidate) {
    return fallback;
  }

  const type = typeof candidate.type === "string" && candidate.type.trim() ? candidate.type.trim().toUpperCase() : fallback.type;
  const location =
    typeof candidate.location === "string" && candidate.location.trim()
      ? candidate.location.trim()
      : fallback.location;
  const units = Array.isArray(candidate.units)
    ? unique(candidate.units.filter((item): item is string => typeof item === "string" && item.trim().length > 0))
    : fallback.units;
  const tags = Array.isArray(candidate.tags)
    ? unique(candidate.tags.filter((item): item is string => typeof item === "string" && item.trim().length > 0))
    : fallback.tags;
  const summary =
    typeof candidate.summary === "string" && candidate.summary.trim()
      ? candidate.summary.trim()
      : `${toTitle(type)} reported near ${location}. Units ${units.length > 0 ? units.join(", ") : "pending assignment"} responding.`;
  const confidence =
    typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
      ? Math.max(0, Math.min(1, candidate.confidence))
      : Math.max(fallback.confidence, 0.66);

  return {
    type,
    location,
    priority: normalizePriority(candidate.priority),
    units,
    summary,
    tags: tags.length > 0 ? tags : fallback.tags,
    confidence
  };
}

async function parseDispatchWithLlmFallback(
  text: string,
  base: DispatchParseResult,
  fallbackConfig: ParseDispatchFallbackConfig
): Promise<DispatchParseResult> {
  if (!fallbackConfig.apiKey || base.confidence >= fallbackConfig.confidenceThreshold) {
    return base;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${fallbackConfig.apiKey}`
      },
      body: JSON.stringify({
        model: fallbackConfig.model,
        temperature: 0,
        input: [
          {
            role: "system",
            content:
              "Extract dispatch fields. Return JSON only with keys type, location, priority, units, summary, tags, confidence."
          },
          {
            role: "user",
            content: text
          }
        ]
      })
    });

    if (!response.ok) {
      return base;
    }

    const payload = (await response.json()) as {
      output_text?: string;
    };
    if (!payload.output_text) {
      return base;
    }

    const parsed = JSON.parse(payload.output_text) as Partial<DispatchParseResult>;
    return sanitizeFallbackResult(parsed, base);
  } catch {
    return base;
  }
}

export function parseDispatch(text: string): DispatchParseResult {
  return parseDispatchRuleFirst(text);
}

export async function parseDispatchWithFallback(
  text: string,
  fallbackConfig: ParseDispatchFallbackConfig
): Promise<DispatchParseResult> {
  const base = parseDispatchRuleFirst(text);
  return parseDispatchWithLlmFallback(text, base, fallbackConfig);
}

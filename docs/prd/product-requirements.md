# Reno SignalStack PRD

## Product goal

Deliver a browser-based situational-awareness experience for the Reno regional airspace and surrounding public-signal environment, combining aircraft movement, weather, permitted cameras, and authorized radio-derived transcripts into explainable information stacks.

## MVP outcomes

- Operator can view the Reno region in a 3D scene with saved viewpoints.
- Operator can inspect aircraft, weather, transcript-derived events, and camera markers.
- Operator can compare raw transcript text with cleaned transcript and structured interpretation.
- Operator can replay recent activity and understand source health, lag, and policy state.
- System remains useful when one or more feeds are degraded or disabled.

## Guardrails

- Use adapters and permissions-aware integration points instead of feed-specific hacks.
- Preserve raw evidence beside AI output.
- Surface confidence explicitly.
- Disable or delay restricted sources by policy.
- Ship value with mock and authorized inputs first.

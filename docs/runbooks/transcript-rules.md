# Transcript Cleanup and Summary Rules

## ATC cleanup

- Preserve operational meaning over grammar.
- Expand phraseology only when confidence is high.
- Normalize runway, heading, altitude, squawk, and frequency tokens.
- Mark uncertainty instead of guessing.
- Never invent callsigns, airports, or clearances.

## Scanner cleanup

- Preserve brevity and radio code semantics.
- Extract agency, unit, incident type, and probable location separately.
- Fall back to area-level location when address confidence is weak.
- Flag tactical or sensitive content for restricted display.

## Summary rule

- Produce short plain-English summaries.
- Keep evidence IDs available to the UI.
- State uncertainty explicitly.
- Avoid tactical recommendations or speculative predictions.

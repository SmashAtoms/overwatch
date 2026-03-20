# Initial Test Cases

- Aircraft markers render with heading, altitude context, and recent trail metadata.
- Replay scrub rebuilds events and stacks consistently.
- Layer outages degrade gracefully and show stale state.
- Raw transcript remains visible when cleanup or summary is wrong.
- Restricted or link-only sources do not expose forbidden embeds or stored media.
- WebSocket reconnect resumes mock live updates without duplicate cards.
- Camera selection links to permitted sources and preserves nearby context.
- Low-confidence scanner events do not auto-promote into high-confidence stacks.
- Region expansion updates filters and scene summaries.
- NLP mock endpoint returns raw, clean, summary, and entities together.

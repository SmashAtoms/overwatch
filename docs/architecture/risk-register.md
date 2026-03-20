# Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| ATC or scanner terms block desired ingestion | Core feature delays | Keep adapters policy-aware, use operator-owned or licensed sources, and retain link-out fallbacks. |
| Noisy transcription creates false meaning | Trust loss | Preserve raw text, expose confidence, and require multi-signal evidence for promoted stacks. |
| Live lag spikes | Degraded situational awareness | Track lag in every adapter, degrade gracefully to stale state, and keep replay/history separate from live caches. |
| Browser 3D cost is too high | Poor operator UX | Use level-of-detail controls, clustering, and later 2.5D fallback if needed. |
| Sensitive public safety context is overexposed | Safety and compliance issue | Delay or restrict scanner-derived views by policy and audit every override. |

# Source Adapter Interfaces

The source adapter contracts live in `packages/contracts/src/index.ts`.

```ts
export interface SourceAdapter<TConfig = unknown> {
  id: string;
  kind: SourceKind;
  start(config: TConfig): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<AdapterHealth>;
}

export interface PullAdapter<TConfig = unknown> extends SourceAdapter<TConfig> {
  poll(since?: string): Promise<Array<NormalizedEnvelope>>;
}

export interface StreamAdapter<TConfig = unknown> extends SourceAdapter<TConfig> {
  subscribe(emit: (event: NormalizedEnvelope) => Promise<void>): Promise<void>;
}
```

Guidelines:

- Normalize provider-specific payloads at the adapter boundary.
- Keep policy mode and lag visible for every adapter.
- Make link-only and delayed modes first-class, not special cases.
- Never assume rebroadcast or archive rights unless the adapter policy explicitly enables them.

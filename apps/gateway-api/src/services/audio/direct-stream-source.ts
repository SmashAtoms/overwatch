type DirectStreamSourceConfig = {
  streamId: string;
  sourceUrl: string;
  chunkIntervalMs: number;
  onChunk: (chunkHint: string) => Promise<void>;
  onError: (error: Error) => void;
};

export class DirectStreamSource {
  private readonly config: DirectStreamSourceConfig;
  private timer: NodeJS.Timeout | null = null;
  private active = false;
  private inFlight = false;
  private lastProbeAt = 0;

  constructor(config: DirectStreamSourceConfig) {
    this.config = config;
  }

  start() {
    if (this.active) {
      return;
    }
    this.active = true;
    this.timer = setInterval(async () => {
      if (this.inFlight) {
        return;
      }
      this.inFlight = true;
      try {
        await this.config.onChunk(`stream:${this.config.streamId}:tick:${Date.now()}`);

        const now = Date.now();
        if (now - this.lastProbeAt >= 15_000) {
          this.lastProbeAt = now;
          const response = await fetch(this.config.sourceUrl, {
            method: "GET",
            signal: AbortSignal.timeout(10_000),
            headers: {
              "user-agent": "SmashAtoms-Overwatch/1.0"
            }
          });

          if (!response.ok) {
            throw new Error(`Audio source returned ${response.status}`);
          }
        }
      } catch (error) {
        this.config.onError(error instanceof Error ? error : new Error("Unknown audio ingest failure"));
      } finally {
        this.inFlight = false;
      }
    }, this.config.chunkIntervalMs);
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.inFlight = false;
  }
}

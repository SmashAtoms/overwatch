import type {
  DispatchCard,
  DispatchSegmentFinalized,
  DispatchSegmentInterim,
  DispatchSummaryWindowEvent,
  DispatchStreamStatus
} from "@signalstack/contracts";
import { parseDispatchWithFallback } from "../ai-parser/parse-dispatch.js";
import { DirectStreamSource } from "../audio/direct-stream-source.js";
import type { TranscriptionProvider } from "../transcription/provider.js";

type PipelineConfig = {
  streamUrls: string[];
  chunkIntervalMs: number;
  finalizeEveryChunks: number;
  provider: TranscriptionProvider;
  parserFallback: {
    apiKey: string | null;
    model: string;
    confidenceThreshold: number;
  };
  onEvent: (event: { type: string; payload: unknown }) => void;
};

type InternalStream = {
  status: DispatchStreamStatus;
  source: DirectStreamSource;
  dedupeFinal: Set<string>;
};

function isoNow() {
  return new Date().toISOString();
}

function toSummaryBullets(card: DispatchCard): string[] {
  return [
    card.summaryBullets[0] ?? card.cleanSentence,
    `Priority ${card.priority.toUpperCase()} | Incident ${card.incidentType}`,
    `Units: ${card.units.length > 0 ? card.units.join(", ") : "pending"}`
  ];
}

export class DispatchPipeline {
  private readonly config: PipelineConfig;
  private readonly streams = new Map<string, InternalStream>();
  private readonly cards: DispatchCard[] = [];
  private readonly summaries2m: DispatchSummaryWindowEvent[] = [];
  private readonly summaries30m: DispatchSummaryWindowEvent[] = [];
  private latestFinalizedLine: DispatchCard | null = null;
  private sequence = 0;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  startAll() {
    this.config.streamUrls.forEach((sourceUrl, index) => {
      const streamId = `dispatch-stream-${index + 1}`;
      this.startStream(streamId, sourceUrl);
    });
  }

  startStream(streamId: string, sourceUrl: string) {
    const existing = this.streams.get(streamId);
    if (existing) {
      existing.source.stop();
    }

    const status: DispatchStreamStatus = {
      streamId,
      sourceUrl,
      state: "running",
      startedAt: isoNow(),
      stoppedAt: null,
      lastError: null,
      sequence: 0,
      receivedSegments: 0,
      finalizedSegments: 0
    };

    const source = new DirectStreamSource({
      streamId,
      sourceUrl,
      chunkIntervalMs: this.config.chunkIntervalMs,
      onChunk: async (chunkHint) => {
        await this.handleChunk(streamId, chunkHint);
      },
      onError: (error) => {
        const current = this.streams.get(streamId);
        if (!current) {
          return;
        }
        current.status.state = "error";
        current.status.lastError = error.message;
        this.config.onEvent({
          type: "dispatch.stream.status",
          payload: current.status
        });
      }
    });

    this.streams.set(streamId, {
      status,
      source,
      dedupeFinal: new Set()
    });

    source.start();
    this.config.onEvent({
      type: "dispatch.stream.status",
      payload: status
    });
  }

  stopStream(streamId: string) {
    const target = this.streams.get(streamId);
    if (!target) {
      return;
    }
    target.source.stop();
    target.status.state = "stopped";
    target.status.stoppedAt = isoNow();
    this.config.onEvent({
      type: "dispatch.stream.status",
      payload: target.status
    });
  }

  stopAll() {
    Array.from(this.streams.keys()).forEach((streamId) => this.stopStream(streamId));
  }

  getStatus() {
    return Array.from(this.streams.values()).map((entry) => entry.status);
  }

  getFeed(limit: number) {
    return this.cards.slice(0, Math.max(1, limit));
  }

  getOverlayPayload() {
    if (!this.latestFinalizedLine) {
      return {
        line: "Waiting for finalized dispatch segments...",
        summary: "No finalized segment has been emitted yet.",
        timestamp: isoNow()
      };
    }

    return {
      line: this.latestFinalizedLine.cleanSentence,
      summary: this.latestFinalizedLine.summaryBullets[0] ?? this.latestFinalizedLine.cleanSentence,
      timestamp: this.latestFinalizedLine.timestamp
    };
  }

  private emitWindowSummaries(streamId: string, timestamp: string) {
    const windowSizes: Array<{ minutes: number; key: "2m" | "30m" }> = [
      { minutes: 2, key: "2m" },
      { minutes: 30, key: "30m" }
    ];

    windowSizes.forEach((windowConfig) => {
      const windowMs = windowConfig.minutes * 60 * 1000;
      const nowMs = new Date(timestamp).getTime();
      const fromMs = nowMs - windowMs;
      const scopedCards = this.cards.filter(
        (card) => card.streamId === streamId && new Date(card.timestamp).getTime() >= fromMs
      );

      if (scopedCards.length === 0) {
        return;
      }

      const summary: DispatchSummaryWindowEvent = {
        id: `${streamId}-${windowConfig.key}-${nowMs}`,
        streamId,
        window: windowConfig.key,
        from: new Date(fromMs).toISOString(),
        to: timestamp,
        timestamp,
        bulletSummary: [
          `${scopedCards.length} finalized segments in the last ${windowConfig.minutes} minutes.`,
          `Top incidents: ${Array.from(new Set(scopedCards.map((card) => card.incidentType))).slice(0, 3).join(", ")}`
        ],
        tags: Array.from(new Set(scopedCards.flatMap((card) => card.tags))).slice(0, 12),
        cardIds: scopedCards.map((card) => card.id)
      };

      if (windowConfig.key === "2m") {
        this.summaries2m.unshift(summary);
      } else {
        this.summaries30m.unshift(summary);
      }

      this.config.onEvent({
        type: windowConfig.key === "2m" ? "dispatch.summary.2min.upsert" : "dispatch.summary.30min.upsert",
        payload: summary
      });
    });
  }

  private async handleChunk(streamId: string, chunkHint: string) {
    const stream = this.streams.get(streamId);
    if (!stream) {
      return;
    }

    stream.status.state = "running";
    stream.status.lastError = null;

    this.sequence += 1;
    const sequence = this.sequence;
    stream.status.sequence = sequence;
    stream.status.receivedSegments += 1;

    const segmentId = `${streamId}-${sequence}`;
    const receivedAt = isoNow();
    const transcript = await this.config.provider.transcribeChunk({ streamId, sequence, chunkHint });

    const interimEvent: DispatchSegmentInterim = {
      streamId,
      segmentId,
      sequence,
      receivedAt,
      finalized: false,
      text: transcript.interim.text
    };

    this.config.onEvent({
      type: "dispatch.segment.interim",
      payload: interimEvent
    });

    const shouldFinalize = sequence % Math.max(1, this.config.finalizeEveryChunks) === 0;
    if (!shouldFinalize) {
      this.config.onEvent({
        type: "dispatch.stream.status",
        payload: stream.status
      });
      return;
    }

    const finalHash = `${streamId}:${transcript.finalized.rawTranscript.toLowerCase()}`;
    if (stream.dedupeFinal.has(finalHash)) {
      return;
    }
    stream.dedupeFinal.add(finalHash);

    const parse = await parseDispatchWithFallback(transcript.finalized.cleanSentence, this.config.parserFallback);
    const finalizedEvent: DispatchSegmentFinalized = {
      streamId,
      segmentId,
      sequence,
      receivedAt: isoNow(),
      finalized: true,
      rawTranscript: transcript.finalized.rawTranscript,
      cleanSentence: transcript.finalized.cleanSentence,
      parse
    };
    stream.status.finalizedSegments += 1;

    this.config.onEvent({
      type: "dispatch.segment.finalized",
      payload: finalizedEvent
    });

    const card: DispatchCard = {
      id: `dispatch-card-${streamId}-${sequence}`,
      streamId,
      segmentId,
      sequence,
      timestamp: isoNow(),
      rawTranscript: finalizedEvent.rawTranscript,
      cleanSentence: finalizedEvent.cleanSentence,
      summaryBullets: [parse.summary],
      tags: parse.tags,
      incidentType: parse.type,
      location: parse.location,
      units: parse.units,
      priority: parse.priority,
      confidence: parse.confidence
    };

    this.cards.unshift(card);
    this.cards.splice(200);
    this.latestFinalizedLine = card;

    this.config.onEvent({
      type: "dispatch.card.upsert",
      payload: card
    });

    this.emitWindowSummaries(streamId, card.timestamp);
    this.config.onEvent({
      type: "dispatch.stream.status",
      payload: stream.status
    });
  }
}

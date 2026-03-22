import type { TranscriptionProvider, TranscriptionResult } from "./provider.js";

const MOCK_LINES = [
  "Engine 6 copy possible vehicle fire eastbound I-80 at Vista, code 3 response.",
  "Medic 2 responding to medical call near 123 Main St and Virginia St.",
  "Unit 14 initiating traffic stop near Plumb and Kietzke.",
  "Dispatch advises disturbance near South Virginia and Damonte Ranch.",
  "Squad 3 reports smoke visible near McCarran and Mill."
];

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly id = "mock";

  async transcribeChunk(params: { streamId: string; sequence: number; chunkHint: string }): Promise<TranscriptionResult> {
    const line = MOCK_LINES[params.sequence % MOCK_LINES.length];
    const interim = line.split(" ").slice(0, 7).join(" ");
    const cleanSentence = line
      .replace(/\bi-80\b/gi, "I-80")
      .replace(/\bcode 3\b/gi, "code 3")
      .trim();

    return {
      interim: { text: `${interim}...` },
      finalized: {
        rawTranscript: line,
        cleanSentence
      }
    };
  }
}


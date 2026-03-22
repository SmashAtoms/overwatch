export type TranscriptionInterim = {
  text: string;
};

export type TranscriptionFinalized = {
  rawTranscript: string;
  cleanSentence: string;
};

export type TranscriptionResult = {
  interim: TranscriptionInterim;
  finalized: TranscriptionFinalized;
};

export type TranscriptionProvider = {
  readonly id: string;
  transcribeChunk(params: { streamId: string; sequence: number; chunkHint: string }): Promise<TranscriptionResult>;
};


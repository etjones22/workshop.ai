export interface StatsSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  elapsedSeconds: number;
  outputTokensPerSecond: number;
  lastResponseTokens: number;
  lastResponseTokensPerSecond: number;
}

export class ConversationStats {
  private inputTokens = 0;
  private outputTokens = 0;
  private startTime = Date.now();
  private outputStartTime: number | null = null;
  private lastResponseStart: number | null = null;
  private lastResponseTokens = 0;
  private lastResponseDurationSec = 0;

  addInput(text: string): number {
    const tokens = estimateTokens(text);
    this.inputTokens += tokens;
    return tokens;
  }

  startResponse(): void {
    this.lastResponseStart = Date.now();
    this.lastResponseTokens = 0;
    if (!this.outputStartTime) {
      this.outputStartTime = this.lastResponseStart;
    }
  }

  addOutputChunk(text: string): number {
    const tokens = estimateTokens(text);
    this.outputTokens += tokens;
    this.lastResponseTokens += tokens;
    return tokens;
  }

  finishResponse(): void {
    if (this.lastResponseStart) {
      this.lastResponseDurationSec = (Date.now() - this.lastResponseStart) / 1000;
    }
    this.lastResponseStart = null;
  }

  snapshot(): StatsSnapshot {
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const outputSeconds = this.outputStartTime ? (Date.now() - this.outputStartTime) / 1000 : 0;
    const outputTokensPerSecond = outputSeconds > 0 ? this.outputTokens / outputSeconds : 0;
    const lastResponseTokensPerSecond =
      this.lastResponseDurationSec > 0 ? this.lastResponseTokens / this.lastResponseDurationSec : 0;

    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
      elapsedSeconds,
      outputTokensPerSecond,
      lastResponseTokens: this.lastResponseTokens,
      lastResponseTokensPerSecond
    };
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.startTime = Date.now();
    this.outputStartTime = null;
    this.lastResponseStart = null;
    this.lastResponseTokens = 0;
    this.lastResponseDurationSec = 0;
  }
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

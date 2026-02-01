export class ConversationStats {
    inputTokens = 0;
    outputTokens = 0;
    startTime = Date.now();
    outputStartTime = null;
    lastResponseStart = null;
    lastResponseTokens = 0;
    lastResponseDurationSec = 0;
    addInput(text) {
        const tokens = estimateTokens(text);
        this.inputTokens += tokens;
        return tokens;
    }
    startResponse() {
        this.lastResponseStart = Date.now();
        this.lastResponseTokens = 0;
        if (!this.outputStartTime) {
            this.outputStartTime = this.lastResponseStart;
        }
    }
    addOutputChunk(text) {
        const tokens = estimateTokens(text);
        this.outputTokens += tokens;
        this.lastResponseTokens += tokens;
        return tokens;
    }
    finishResponse() {
        if (this.lastResponseStart) {
            this.lastResponseDurationSec = (Date.now() - this.lastResponseStart) / 1000;
        }
        this.lastResponseStart = null;
    }
    snapshot() {
        const elapsedSeconds = (Date.now() - this.startTime) / 1000;
        const outputSeconds = this.outputStartTime ? (Date.now() - this.outputStartTime) / 1000 : 0;
        const outputTokensPerSecond = outputSeconds > 0 ? this.outputTokens / outputSeconds : 0;
        const lastResponseTokensPerSecond = this.lastResponseDurationSec > 0 ? this.lastResponseTokens / this.lastResponseDurationSec : 0;
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
    reset() {
        this.inputTokens = 0;
        this.outputTokens = 0;
        this.startTime = Date.now();
        this.outputStartTime = null;
        this.lastResponseStart = null;
        this.lastResponseTokens = 0;
        this.lastResponseDurationSec = 0;
    }
}
export function estimateTokens(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return 0;
    }
    return Math.max(1, Math.ceil(trimmed.length / 4));
}

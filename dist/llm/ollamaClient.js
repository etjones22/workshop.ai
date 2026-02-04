export class OllamaClient {
    baseUrl;
    apiKey;
    model;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/$/, "");
        this.apiKey = options.apiKey;
        this.model = options.model;
    }
    async chat(params) {
        const hasTools = Array.isArray(params.tools) && params.tools.length > 0;
        const body = {
            model: this.model,
            messages: params.messages,
            temperature: params.temperature ?? 0
        };
        if (hasTools) {
            body.tools = params.tools;
            body.tool_choice = params.toolChoice ?? "auto";
        }
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`
            },
            signal: params.signal,
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`LLM error ${response.status}: ${text}`);
        }
        return (await response.json());
    }
    async *chatStream(params) {
        const hasTools = Array.isArray(params.tools) && params.tools.length > 0;
        const body = {
            model: this.model,
            messages: params.messages,
            temperature: params.temperature ?? 0,
            stream: true
        };
        if (hasTools) {
            body.tools = params.tools;
            body.tool_choice = params.toolChoice ?? "auto";
        }
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`
            },
            signal: params.signal,
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`LLM error ${response.status}: ${text}`);
        }
        if (!response.body) {
            throw new Error("Streaming response body is unavailable");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) {
                    continue;
                }
                const data = trimmed.slice(5).trim();
                if (!data || data === "[DONE]") {
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    yield parsed;
                }
                catch {
                    continue;
                }
            }
        }
        if (buffer.trim().startsWith("data:")) {
            const data = buffer.trim().slice(5).trim();
            if (data && data !== "[DONE]") {
                try {
                    const parsed = JSON.parse(data);
                    yield parsed;
                }
                catch {
                    return;
                }
            }
        }
    }
}

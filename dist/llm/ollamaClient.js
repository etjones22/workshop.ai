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
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: this.model,
                messages: params.messages,
                tools: params.tools,
                tool_choice: params.toolChoice ?? "auto",
                temperature: params.temperature ?? 0
            })
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`LLM error ${response.status}: ${text}`);
        }
        return (await response.json());
    }
}

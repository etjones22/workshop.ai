export function createRemoteSession(options) {
    let sessionId;
    const send = async (message, onToken, onAgent) => {
        const payload = { message };
        if (sessionId) {
            payload.sessionId = sessionId;
        }
        if (options.userId) {
            payload.userId = options.userId;
        }
        const response = await fetch(new URL("/chat", options.baseUrl).toString(), {
            method: "POST",
            headers: buildHeaders(options),
            body: JSON.stringify(payload)
        });
        if (!response.ok || !response.body) {
            const text = await response.text();
            throw new Error(text || `Remote error ${response.status}`);
        }
        let output = "";
        for await (const event of streamSse(response)) {
            if (event.type === "session" && event.sessionId) {
                sessionId = event.sessionId;
            }
            else if (event.type === "token" && typeof event.token === "string") {
                output += event.token;
                onToken?.(event.token);
            }
            else if (event.type === "agent" && typeof event.name === "string" && typeof event.content === "string") {
                onAgent?.({ name: event.name, content: event.content });
            }
            else if (event.type === "error") {
                throw new Error(event.message || "Remote error");
            }
        }
        return output.trim();
    };
    const reset = async () => {
        if (!sessionId) {
            return;
        }
        await fetch(new URL("/reset", options.baseUrl).toString(), {
            method: "POST",
            headers: buildHeaders(options),
            body: JSON.stringify({ sessionId })
        });
    };
    return { sessionId, send, reset };
}
function buildHeaders(options) {
    const headers = {
        "Content-Type": "application/json"
    };
    if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }
    if (options.userId) {
        headers["X-User-Id"] = options.userId;
    }
    return headers;
}
async function* streamSse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\n\n/);
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
            const data = extractSseData(chunk);
            if (!data) {
                continue;
            }
            try {
                yield JSON.parse(data);
            }
            catch {
                continue;
            }
        }
    }
    const trailing = extractSseData(buffer);
    if (trailing) {
        try {
            yield JSON.parse(trailing);
        }
        catch {
            return;
        }
    }
}
function extractSseData(chunk) {
    const lines = chunk.split(/\r?\n/);
    const dataLines = lines
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) {
        return null;
    }
    return dataLines.join("\n");
}

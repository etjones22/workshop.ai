export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolCallDelta {
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string | null;
  }>;
}

export interface ChatCompletionChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      role?: Role;
      content?: string;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
}

export interface OllamaClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OllamaClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(options: OllamaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async chat(params: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    toolChoice?: "auto" | "none";
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<ChatCompletionResponse> {
    const hasTools = Array.isArray(params.tools) && params.tools.length > 0;
    const body: Record<string, unknown> = {
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

    return (await response.json()) as ChatCompletionResponse;
  }

  async *chatStream(params: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    toolChoice?: "auto" | "none";
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatCompletionChunk> {
    const hasTools = Array.isArray(params.tools) && params.tools.length > 0;
    const body: Record<string, unknown> = {
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
          const parsed = JSON.parse(data) as ChatCompletionChunk;
          yield parsed;
        } catch {
          continue;
        }
      }
    }

    if (buffer.trim().startsWith("data:")) {
      const data = buffer.trim().slice(5).trim();
      if (data && data !== "[DONE]") {
        try {
          const parsed = JSON.parse(data) as ChatCompletionChunk;
          yield parsed;
        } catch {
          return;
        }
      }
    }
  }
}

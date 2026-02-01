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
  }): Promise<ChatCompletionResponse> {
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

    return (await response.json()) as ChatCompletionResponse;
  }
}

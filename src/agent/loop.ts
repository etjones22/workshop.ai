import path from "node:path";
import readline from "node:readline";
import { OllamaClient, type ChatMessage, type ToolCall, type ToolCallDelta } from "../llm/ollamaClient.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { createToolRegistry } from "../tools/index.js";
import { createSessionLogger } from "../util/logger.js";
import { ensureWorkspaceRoot } from "../util/sandboxPath.js";

export interface AgentOptions {
  request: string;
  autoApprove: boolean;
  maxSteps: number;
}

export interface AgentSessionOptions {
  autoApprove: boolean;
  maxSteps: number;
  confirm?: (question: string) => Promise<boolean>;
  onToken?: (token: string) => void;
  workspaceRoot?: string;
  baseDir?: string;
}

export interface AgentSession {
  runTurn: (request: string, options?: { onToken?: (token: string) => void }) => Promise<string>;
  reset: () => Promise<void>;
}

export async function createAgentSession(options: AgentSessionOptions): Promise<AgentSession> {
  const baseDir = options.baseDir ?? process.cwd();
  const workspaceRoot = options.workspaceRoot ?? path.join(baseDir, "workspace");
  await ensureWorkspaceRoot(workspaceRoot);

  const logger = await createSessionLogger(baseDir);
  const tools = createToolRegistry(workspaceRoot);
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "gpt-oss:20b"
  });

  const confirm = options.confirm ?? promptYesNo;
  let messages: ChatMessage[] = [{ role: "system", content: buildSystemPrompt(options.autoApprove) }];
  await logger.log({ type: "message", role: "system", content: messages[0].content });

  async function runTurn(request: string, runOptions?: { onToken?: (token: string) => void }): Promise<string> {
    const onToken = runOptions?.onToken ?? options.onToken;
    messages.push({ role: "user", content: request });
    await logger.log({ type: "message", role: "user", content: request });

    for (let step = 0; step < options.maxSteps; step += 1) {
      let message: ChatMessage | null = null;

      if (onToken) {
        const streamed = await streamAssistantResponse(
          client,
          messages,
          tools.definitions,
          onToken
        );
        message = streamed;
      } else {
        const response = await client.chat({ messages, tools: tools.definitions, toolChoice: "auto" });
        const choice = response.choices[0];
        message = choice?.message ?? null;
      }

      if (!message) {
        return "No response from model.";
      }

      messages.push(message);
      await logger.log({ type: "message", role: "assistant", content: message.content, tool_calls: message.tool_calls });

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          let args: any = {};
          try {
            args = JSON.parse(toolCall.function.arguments || "{}");
          } catch (err) {
            const error = `Invalid tool arguments for ${toolName}`;
            const toolMessage = {
              role: "tool" as const,
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error })
            };
            messages.push(toolMessage);
            await logger.log({ type: "tool_call", name: toolName, arguments: toolCall.function.arguments });
            await logger.log({ type: "tool_result", name: toolName, result: { error } });
            continue;
          }

          await logger.log({ type: "tool_call", name: toolName, arguments: args });

          let allowed = true;
          if (tools.writeTools.has(toolName) && !options.autoApprove) {
            allowed = await confirm(`Approve ${toolName} to write to workspace? (y/N) `);
          }

          let result: any;
          if (!allowed) {
            result = { error: "User declined write operation" };
          } else {
            const handler = tools.handlers[toolName];
            if (!handler) {
              result = { error: `Unknown tool: ${toolName}` };
            } else {
              try {
                result = await handler(args);
              } catch (err) {
                result = { error: (err as Error).message };
              }
            }
          }

          const toolMessage = {
            role: "tool" as const,
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          };
          messages.push(toolMessage);
          await logger.log({ type: "tool_result", name: toolName, result });
        }
        continue;
      }

      if (message.content && message.content.trim().length > 0) {
        return message.content;
      }
    }

    return `Reached max steps (${options.maxSteps}) without final response.`;
  }

  async function reset(): Promise<void> {
    messages = [{ role: "system", content: buildSystemPrompt(options.autoApprove) }];
    await logger.log({ type: "message", role: "system", content: messages[0].content });
  }

  return { runTurn, reset };
}

export async function runAgent(options: AgentOptions): Promise<string> {
  const session = await createAgentSession({
    autoApprove: options.autoApprove,
    maxSteps: options.maxSteps
  });
  return session.runTurn(options.request);
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

async function streamAssistantResponse(
  client: OllamaClient,
  messages: ChatMessage[],
  tools: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[],
  onToken: (token: string) => void
): Promise<ChatMessage> {
  let content = "";
  const toolCalls: ToolCall[] = [];

  for await (const chunk of client.chatStream({ messages, tools, toolChoice: "auto" })) {
    const choice = chunk.choices[0];
    const delta = choice?.delta;
    if (!delta) {
      continue;
    }
    if (delta.content) {
      content += delta.content;
      onToken(delta.content);
    }
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      mergeToolCallDeltas(toolCalls, delta.tool_calls);
    }
  }

  const message: ChatMessage = {
    role: "assistant",
    content: content.length > 0 ? content : null
  };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }
  return message;
}

function mergeToolCallDeltas(target: ToolCall[], deltas: ToolCallDelta[]): void {
  for (const delta of deltas) {
    const index = resolveToolCallIndex(target, delta);
    if (!target[index]) {
      target[index] = {
        id: delta.id ?? `call_${Date.now()}_${index}`,
        type: "function",
        function: {
          name: "",
          arguments: ""
        }
      };
    }

    const current = target[index];
    if (delta.id && current.id !== delta.id) {
      current.id = delta.id;
    }
    if (delta.function?.name) {
      current.function.name = delta.function.name;
    }
    if (delta.function?.arguments) {
      current.function.arguments += delta.function.arguments;
    }
  }
}

function resolveToolCallIndex(target: ToolCall[], delta: ToolCallDelta): number {
  if (typeof delta.index === "number") {
    return delta.index;
  }
  if (delta.id) {
    const existing = target.findIndex((call) => call.id === delta.id);
    if (existing >= 0) {
      return existing;
    }
  }
  return target.length;
}

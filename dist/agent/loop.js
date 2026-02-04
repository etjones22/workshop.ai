import path from "node:path";
import readline from "node:readline";
import { OllamaClient } from "../llm/ollamaClient.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { routeAgent } from "./router.js";
import { createToolRegistry } from "../tools/index.js";
import { createSessionLogger } from "../util/logger.js";
import { ensureWorkspaceRoot } from "../util/sandboxPath.js";
import { DEFAULT_CONFIG } from "../util/config.js";
export async function createAgentSession(options) {
    const baseDir = options.baseDir ?? process.cwd();
    const workspaceRoot = options.workspaceRoot ?? path.join(baseDir, "workspace");
    await ensureWorkspaceRoot(workspaceRoot);
    const llmConfig = options.llmConfig ?? DEFAULT_CONFIG.llm;
    const logger = await createSessionLogger(baseDir);
    const tools = createToolRegistry(workspaceRoot, llmConfig);
    const client = new OllamaClient({
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model
    });
    const confirm = options.confirm ?? promptYesNo;
    let messages = [{ role: "system", content: buildSystemPrompt(options.autoApprove) }];
    await logger.log({ type: "message", role: "system", content: messages[0].content });
    async function runTurn(request, runOptions) {
        const onToken = runOptions?.onToken ?? options.onToken;
        const onAgent = runOptions?.onAgent ?? options.onAgent;
        const signal = runOptions?.signal;
        messages.push({ role: "user", content: request });
        await logger.log({ type: "message", role: "user", content: request });
        const routed = routeAgent(request);
        if (routed) {
            const draft = await runSpecialistAgent(client, routed.agent, request);
            if (draft.trim()) {
                onAgent?.({ name: routed.agent.name, content: draft });
                await logger.log({
                    type: "agent",
                    id: routed.agent.id,
                    name: routed.agent.name,
                    reason: routed.reason,
                    content: draft
                });
                messages.push({
                    role: "system",
                    content: buildAgentContext(routed.agent, draft)
                });
            }
        }
        for (let step = 0; step < options.maxSteps; step += 1) {
            let message = null;
            if (onToken) {
                const streamed = await streamAssistantResponse(client, messages, tools.definitions, onToken, signal);
                message = streamed;
            }
            else {
                const response = await client.chat({
                    messages,
                    tools: tools.definitions,
                    toolChoice: "auto",
                    signal
                });
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
                    let args = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments || "{}");
                    }
                    catch (err) {
                        const error = `Invalid tool arguments for ${toolName}`;
                        const toolMessage = {
                            role: "tool",
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
                    let result;
                    if (!allowed) {
                        result = { error: "User declined write operation" };
                    }
                    else {
                        const handler = tools.handlers[toolName];
                        if (!handler) {
                            result = { error: `Unknown tool: ${toolName}` };
                        }
                        else {
                            try {
                                result = await handler(args);
                            }
                            catch (err) {
                                result = { error: err.message };
                            }
                        }
                    }
                    const toolMessage = {
                        role: "tool",
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
    async function reset() {
        messages = [{ role: "system", content: buildSystemPrompt(options.autoApprove) }];
        await logger.log({ type: "message", role: "system", content: messages[0].content });
    }
    return { runTurn, reset };
}
export async function runAgent(options) {
    const session = await createAgentSession({
        autoApprove: options.autoApprove,
        maxSteps: options.maxSteps,
        llmConfig: options.llmConfig
    });
    return session.runTurn(options.request);
}
async function promptYesNo(question) {
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
async function streamAssistantResponse(client, messages, tools, onToken, signal) {
    let content = "";
    const toolCalls = [];
    for await (const chunk of client.chatStream({ messages, tools, toolChoice: "auto", signal })) {
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
    const message = {
        role: "assistant",
        content: content.length > 0 ? content : null
    };
    if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
    }
    return message;
}
function buildAgentContext(agent, content) {
    return [
        `Specialist agent (${agent.name}) output:`,
        content,
        "Use this as draft guidance and respond to the user."
    ].join("\n");
}
async function runSpecialistAgent(client, agent, request) {
    const response = await client.chat({
        messages: [
            { role: "system", content: agent.systemPrompt },
            { role: "user", content: request }
        ],
        toolChoice: "none",
        temperature: 0.2
    });
    return response.choices[0]?.message?.content ?? "";
}
function mergeToolCallDeltas(target, deltas) {
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
function resolveToolCallIndex(target, delta) {
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

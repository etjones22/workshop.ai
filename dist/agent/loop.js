import path from "node:path";
import readline from "node:readline";
import { OllamaClient } from "../llm/ollamaClient.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { createToolRegistry } from "../tools/index.js";
import { createSessionLogger } from "../util/logger.js";
import { ensureWorkspaceRoot } from "../util/sandboxPath.js";
export async function createAgentSession(options) {
    const workspaceRoot = path.join(process.cwd(), "workspace");
    await ensureWorkspaceRoot(workspaceRoot);
    const logger = await createSessionLogger(process.cwd());
    const tools = createToolRegistry(workspaceRoot);
    const client = new OllamaClient({
        baseUrl: "http://localhost:11434/v1",
        apiKey: "ollama",
        model: "gpt-oss:20b"
    });
    const confirm = options.confirm ?? promptYesNo;
    let messages = [{ role: "system", content: buildSystemPrompt(options.autoApprove) }];
    await logger.log({ type: "message", role: "system", content: messages[0].content });
    async function runTurn(request) {
        messages.push({ role: "user", content: request });
        await logger.log({ type: "message", role: "user", content: request });
        for (let step = 0; step < options.maxSteps; step += 1) {
            const response = await client.chat({ messages, tools: tools.definitions, toolChoice: "auto" });
            const choice = response.choices[0];
            const message = choice?.message;
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
        maxSteps: options.maxSteps
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

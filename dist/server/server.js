import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAgentSession } from "../agent/loop.js";
import { ensureWorkspaceRoot } from "../util/sandboxPath.js";
import { estimateTokens } from "../util/stats.js";
export async function startServer(options) {
    const sessions = new Map();
    await ensureWorkspaceRoot(path.join(options.baseDir, "workspaces"));
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
            const method = req.method ?? "GET";
            if (method === "GET" && url.pathname === "/health") {
                return sendJson(res, 200, { ok: true });
            }
            if (options.token) {
                const auth = req.headers.authorization ?? "";
                const expected = `Bearer ${options.token}`;
                if (auth !== expected) {
                    return sendJson(res, 401, { error: "Unauthorized" });
                }
            }
            if (method === "POST" && url.pathname === "/session") {
                const body = await readJson(req);
                const userId = sanitizeUserId(body.userId ?? req.headers["x-user-id"] ?? "default");
                const record = await createSessionRecord(options, userId);
                sessions.set(record.id, record);
                return sendJson(res, 200, { sessionId: record.id });
            }
            if (method === "POST" && url.pathname === "/reset") {
                const body = await readJson(req);
                const sessionId = body.sessionId;
                if (!sessionId || !sessions.has(sessionId)) {
                    return sendJson(res, 404, { error: "Session not found" });
                }
                const record = sessions.get(sessionId);
                await record.session.reset();
                return sendJson(res, 200, { ok: true });
            }
            if (method === "POST" && url.pathname === "/chat") {
                const body = await readJson(req);
                const message = body.message;
                if (!message || typeof message !== "string") {
                    return sendJson(res, 400, { error: "Missing message" });
                }
                const userId = sanitizeUserId(body.userId ?? req.headers["x-user-id"] ?? "default");
                let sessionId = body.sessionId;
                let record;
                let isNewSession = false;
                if (sessionId && sessions.has(sessionId)) {
                    record = sessions.get(sessionId);
                }
                if (!record) {
                    const created = await createSessionRecord(options, userId);
                    sessionId = created.id;
                    record = created;
                    sessions.set(sessionId, record);
                    isNewSession = true;
                }
                if (record.busy) {
                    return sendJson(res, 409, { error: "Session is busy" });
                }
                record.busy = true;
                const clientIp = getClientIp(req);
                const inputTokens = estimateTokens(message);
                const inputChars = message.length;
                const preview = message.replace(/\s+/g, " ").slice(0, 200);
                const startTime = Date.now();
                console.log(`Incoming request from ${clientIp} | user=${userId} | session=${sessionId} | chars=${inputChars} | tokens~${inputTokens}`);
                console.log(`Message: ${preview}${message.length > 200 ? "..." : ""}`);
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                    "X-Accel-Buffering": "no"
                });
                res.flushHeaders();
                if (isNewSession) {
                    writeSse(res, { type: "session", sessionId });
                }
                let closed = false;
                req.on("close", () => {
                    closed = true;
                });
                let outputTokens = 0;
                let outputChars = 0;
                try {
                    await record.session.runTurn(message, {
                        onToken: (token) => {
                            if (closed) {
                                return;
                            }
                            outputTokens += estimateTokens(token);
                            outputChars += token.length;
                            writeSse(res, { type: "token", token });
                        }
                    });
                    if (!closed) {
                        writeSse(res, { type: "done" });
                    }
                }
                catch (err) {
                    if (!closed) {
                        writeSse(res, { type: "error", message: String(err) });
                    }
                }
                finally {
                    const durationSec = (Date.now() - startTime) / 1000;
                    const totalTokens = inputTokens + outputTokens;
                    console.log(`Completed request | user=${userId} | session=${sessionId} | in~${inputTokens} out~${outputTokens} total~${totalTokens} | chars in=${inputChars} out=${outputChars} | ${durationSec.toFixed(2)}s`);
                    record.busy = false;
                    res.end();
                }
                return;
            }
            return sendJson(res, 404, { error: "Not found" });
        }
        catch (err) {
            return sendJson(res, 500, { error: String(err) });
        }
    });
    return new Promise((resolve) => {
        server.listen(options.port, options.host, () => resolve(server));
    });
}
async function createSessionRecord(options, userId) {
    const workspaceRoot = path.join(options.baseDir, "workspaces", userId);
    await ensureWorkspaceRoot(workspaceRoot);
    const session = await createAgentSession({
        autoApprove: options.autoApprove,
        maxSteps: options.maxSteps,
        confirm: options.autoApprove ? undefined : async () => false,
        baseDir: options.baseDir,
        workspaceRoot
    });
    const id = randomUUID();
    return { id, session, busy: false, userId, workspaceRoot };
}
function writeSse(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
function sendJson(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
}
async function readJson(req) {
    let body = "";
    for await (const chunk of req) {
        body += chunk;
    }
    if (!body) {
        return {};
    }
    try {
        return JSON.parse(body);
    }
    catch {
        return {};
    }
}
function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
        return forwarded[0];
    }
    return req.socket.remoteAddress ?? "unknown";
}
function sanitizeUserId(input) {
    const raw = String(input).trim();
    if (!raw) {
        return "default";
    }
    return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

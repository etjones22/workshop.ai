import path from "node:path";
import fs from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { OllamaClient } from "../llm/ollamaClient.js";
import { ensureWorkspaceRoot, resolveSandboxPath } from "../util/sandboxPath.js";
import { webFetch } from "./web.js";
const defaultClient = new OllamaClient({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "gpt-oss:20b"
});
const DEFAULT_MAX_CHARS = 60000;
const DEFAULT_CHUNK_CHARS = 12000;
export async function docSummarize(workspaceRoot, options, client) {
    const llm = client ?? defaultClient;
    const source = String(options.source ?? "").trim();
    if (!source) {
        return {
            source: "",
            sourceType: "file",
            style: options.style ?? "brief",
            error: "Missing source"
        };
    }
    const style = options.style ?? "brief";
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    try {
        const loaded = await loadSourceText(workspaceRoot, source, maxChars);
        const normalized = normalizeText(loaded.text);
        if (!normalized) {
            return {
                source,
                sourceType: loaded.sourceType,
                title: loaded.title,
                style,
                focus: options.focus,
                truncated: loaded.truncated,
                textChars: 0,
                error: "No text could be extracted from the source"
            };
        }
        const chunks = splitIntoChunks(normalized, DEFAULT_CHUNK_CHARS);
        const chunkSummaries = [];
        for (let index = 0; index < chunks.length; index += 1) {
            const chunkSummary = await summarizeChunk(llm, chunks[index], {
                style,
                focus: options.focus,
                index,
                total: chunks.length
            });
            if (chunkSummary) {
                chunkSummaries.push(chunkSummary);
            }
        }
        if (!chunkSummaries.length) {
            return {
                source,
                sourceType: loaded.sourceType,
                title: loaded.title,
                style,
                focus: options.focus,
                truncated: loaded.truncated,
                textChars: normalized.length,
                chunkCount: chunks.length,
                error: "Failed to generate summary"
            };
        }
        const summary = chunkSummaries.length === 1
            ? chunkSummaries[0]
            : await summarizeCombined(llm, chunkSummaries, style, options.focus);
        return {
            source,
            sourceType: loaded.sourceType,
            title: loaded.title,
            summary: summary?.trim(),
            style,
            focus: options.focus,
            chunkCount: chunks.length,
            textChars: normalized.length,
            truncated: loaded.truncated
        };
    }
    catch (err) {
        return {
            source,
            sourceType: isUrl(source) ? "url" : "file",
            style,
            focus: options.focus,
            error: err.message
        };
    }
}
async function loadSourceText(workspaceRoot, source, maxChars) {
    if (isUrl(source)) {
        const fetched = await webFetch(source, maxChars);
        return {
            text: fetched.text,
            title: fetched.title,
            truncated: fetched.text.length >= maxChars,
            sourceType: "url"
        };
    }
    const rootReal = await ensureWorkspaceRoot(workspaceRoot);
    const resolved = await resolveSandboxPath(rootReal, source);
    const buffer = await fs.readFile(resolved.absolutePath);
    const ext = path.extname(resolved.absolutePath).toLowerCase();
    let text = buffer.toString("utf8");
    let title;
    if (ext === ".html" || ext === ".htm") {
        const html = text;
        const virtualConsole = new VirtualConsole();
        virtualConsole.on("jsdomError", (err) => {
            const message = String(err);
            if (message.includes("Could not parse CSS stylesheet")) {
                return;
            }
            console.warn(message);
        });
        const dom = new JSDOM(html, {
            url: `file://${resolved.absolutePath.replace(/\\/g, "/")}`,
            virtualConsole
        });
        const document = dom.window.document;
        title = document.title || undefined;
        const reader = new Readability(document);
        const article = reader.parse();
        text = article?.textContent || document.body?.textContent || "";
    }
    const truncated = text.length > maxChars;
    if (truncated) {
        text = text.slice(0, maxChars);
    }
    return { text, title, truncated, sourceType: "file" };
}
function isUrl(value) {
    return /^https?:\/\//i.test(value);
}
function normalizeText(text) {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function splitIntoChunks(text, maxChunkChars) {
    if (text.length <= maxChunkChars) {
        return [text];
    }
    const paragraphs = text.split(/\n\s*\n/);
    const chunks = [];
    let current = "";
    for (const paragraph of paragraphs) {
        const next = current ? `${current}\n\n${paragraph}` : paragraph;
        if (next.length > maxChunkChars) {
            if (current) {
                chunks.push(current);
            }
            if (paragraph.length > maxChunkChars) {
                let start = 0;
                while (start < paragraph.length) {
                    chunks.push(paragraph.slice(start, start + maxChunkChars));
                    start += maxChunkChars;
                }
                current = "";
            }
            else {
                current = paragraph;
            }
        }
        else {
            current = next;
        }
    }
    if (current) {
        chunks.push(current);
    }
    return chunks;
}
async function summarizeChunk(client, chunk, options) {
    const focusLine = options.focus ? `Focus on: ${options.focus}` : "Focus on the most important points.";
    const styleLine = styleInstruction(options.style);
    const messages = [
        {
            role: "system",
            content: "You are a precise document summarizer. Be faithful to the source, avoid speculation, and keep the summary concise."
        },
        {
            role: "user",
            content: `Summarize part ${options.index + 1} of ${options.total}.\n${focusLine}\n${styleLine}\n\nDocument:\n${chunk}`
        }
    ];
    const response = await client.chat({ messages, toolChoice: "none", temperature: 0.2 });
    return response.choices[0]?.message?.content?.trim() ?? "";
}
async function summarizeCombined(client, summaries, style, focus) {
    const focusLine = focus ? `Focus on: ${focus}` : "Focus on the most important points.";
    const styleLine = styleInstruction(style);
    const joined = summaries.map((summary, index) => `Chunk ${index + 1} summary:\n${summary}`).join("\n\n");
    const messages = [
        {
            role: "system",
            content: "You are a precise document summarizer. Combine multiple chunk summaries into one cohesive summary."
        },
        {
            role: "user",
            content: `Combine the following chunk summaries into a single summary.\n${focusLine}\n${styleLine}\n\n${joined}`
        }
    ];
    const response = await client.chat({ messages, toolChoice: "none", temperature: 0.2 });
    return response.choices[0]?.message?.content?.trim() ?? summaries.join("\n\n");
}
function styleInstruction(style) {
    if (style === "bullets") {
        return "Return a concise bullet list with 5-10 bullets.";
    }
    if (style === "detailed") {
        return "Return a detailed summary with short paragraphs and clear structure.";
    }
    return "Return a concise paragraph summary (about 5-8 sentences).";
}

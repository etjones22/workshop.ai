import { OllamaClient } from "../llm/ollamaClient.js";
import { webSearch, webFetch } from "./web.js";
import { fsList, fsRead, fsWrite, fsApplyPatch } from "./fs.js";
import { docSummarize } from "./doc.js";
export function createToolRegistry(workspaceRoot, llmConfig) {
    const docClient = llmConfig ? new OllamaClient(llmConfig) : undefined;
    const definitions = [
        {
            type: "function",
            function: {
                name: "web_search",
                description: "Search the web for relevant results and optionally fetch article text.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string" },
                        count: { type: "integer", minimum: 1, maximum: 10 },
                        fetch: { type: "boolean" },
                        fetchCount: { type: "integer", minimum: 1, maximum: 5 },
                        maxChars: { type: "integer", minimum: 100, maximum: 200000 }
                    },
                    required: ["query"],
                    additionalProperties: false
                }
            }
        },
        {
            type: "function",
            function: {
                name: "web_fetch",
                description: "Fetch readable text content from a URL.",
                parameters: {
                    type: "object",
                    properties: {
                        url: { type: "string" },
                        maxChars: { type: "integer", minimum: 100, maximum: 200000 }
                    },
                    required: ["url"],
                    additionalProperties: false
                }
            }
        },
        {
            type: "function",
            function: {
                name: "fs_list",
                description: "List files or directories in the workspace.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string" }
                    },
                    additionalProperties: false
                }
            }
        },
        {
            type: "function",
            function: {
                name: "fs_read",
                description: "Read a file from the workspace.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string" }
                    },
                    required: ["path"],
                    additionalProperties: false
                }
            }
        },
        {
            type: "function",
            function: {
                name: "fs_write",
                description: "Write a file to the workspace.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                        overwrite: { type: "boolean" }
                    },
                    required: ["path", "content"],
                    additionalProperties: false
                }
            }
        },
        {
            type: "function",
            function: {
                name: "fs_apply_patch",
                description: "Apply a patch to one or more workspace files.",
                parameters: {
                    type: "object",
                    properties: {
                        patch: { type: "string" }
                    },
                    required: ["patch"],
                    additionalProperties: false
                }
            }
        },
        {
            type: "function",
            function: {
                name: "doc_summarize",
                description: "Summarize a local document or URL using the local model.",
                parameters: {
                    type: "object",
                    properties: {
                        source: { type: "string" },
                        maxChars: { type: "integer", minimum: 100, maximum: 400000 },
                        style: { type: "string", enum: ["brief", "detailed", "bullets"] },
                        focus: { type: "string" }
                    },
                    required: ["source"],
                    additionalProperties: false
                }
            }
        }
    ];
    const handlers = {
        web_search: async (args) => webSearch(args.query, {
            count: args.count,
            fetch: args.fetch,
            fetchCount: args.fetchCount,
            maxChars: args.maxChars
        }),
        web_fetch: async (args) => webFetch(args.url, args.maxChars),
        fs_list: async (args) => fsList(workspaceRoot, args.path ?? "."),
        fs_read: async (args) => fsRead(workspaceRoot, args.path),
        fs_write: async (args) => fsWrite(workspaceRoot, args.path, args.content, args.overwrite ?? false),
        fs_apply_patch: async (args) => fsApplyPatch(workspaceRoot, args.patch),
        doc_summarize: async (args) => docSummarize(workspaceRoot, {
            source: args.source,
            maxChars: args.maxChars,
            style: args.style,
            focus: args.focus
        }, docClient)
    };
    const writeTools = new Set(["fs_write", "fs_apply_patch"]);
    return { definitions, handlers, writeTools };
}

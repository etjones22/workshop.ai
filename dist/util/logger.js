import path from "node:path";
import fs from "node:fs/promises";
export async function createSessionLogger(baseDir) {
    const sessionsDir = path.join(baseDir, ".workshop", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(sessionsDir, `${timestamp}.jsonl`);
    return {
        filePath,
        async log(entry) {
            const line = JSON.stringify({ ts: new Date().toISOString(), ...(entry || {}) });
            await fs.appendFile(filePath, `${line}\n`, "utf8");
        }
    };
}

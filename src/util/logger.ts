import path from "node:path";
import fs from "node:fs/promises";

export interface SessionLogger {
  filePath: string;
  log: (entry: unknown) => Promise<void>;
}

export async function createSessionLogger(baseDir: string): Promise<SessionLogger> {
  const sessionsDir = path.join(baseDir, ".workshop", "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(sessionsDir, `${timestamp}.jsonl`);

  return {
    filePath,
    async log(entry: unknown) {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...((entry as object) || {}) });
      await fs.appendFile(filePath, `${line}\n`, "utf8");
    }
  };
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface HealthCheckResult {
  success: boolean;
  output: string;
}

export async function runHealthChecks(baseDir: string): Promise<HealthCheckResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "npm",
      ["test", "--", "--reporter=basic"],
      { cwd: baseDir, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );
    const output = `${stdout}${stderr}`.trim();
    return { success: true, output };
  } catch (err) {
    const anyErr = err as { stdout?: string; stderr?: string; message?: string };
    const output = `${anyErr.stdout ?? ""}${anyErr.stderr ?? ""}${anyErr.message ?? ""}`.trim();
    return { success: false, output };
  }
}

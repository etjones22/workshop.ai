import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VersionInfo {
  name: string;
  version: string;
  commit?: string;
  updated?: string;
}

export async function getVersionInfo(baseDir: string = process.cwd()): Promise<VersionInfo> {
  const pkg = await readPackageJson(baseDir);
  const gitInfo = await readGitInfo(baseDir);
  return {
    name: pkg.name ?? "Workshop.AI",
    version: pkg.version ?? "0.0.0",
    commit: gitInfo?.commit,
    updated: gitInfo?.updated
  };
}

export function formatVersionBanner(info: VersionInfo): string {
  const name = normalizeName(info.name);
  const version = `v${info.version}`;
  if (info.commit && info.updated) {
    return `${name} - ${version} - Last updated ${info.updated} (${info.commit})`;
  }
  if (info.commit) {
    return `${name} - ${version} - Commit ${info.commit}`;
  }
  return `${name} - ${version}`;
}

async function readPackageJson(baseDir: string): Promise<{ name?: string; version?: string }> {
  try {
    const filePath = path.join(baseDir, "package.json");
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as { name?: string; version?: string };
  } catch {
    return { name: "Workshop.AI", version: "0.0.0" };
  }
}

async function readGitInfo(baseDir: string): Promise<{ commit?: string; updated?: string } | null> {
  try {
    await execFileAsync("git", ["--version"], { cwd: baseDir, windowsHide: true });
  } catch {
    return null;
  }

  try {
    const { stdout: sha } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: baseDir,
      windowsHide: true
    });
    const { stdout: date } = await execFileAsync("git", ["log", "-1", "--format=%cI"], {
      cwd: baseDir,
      windowsHide: true
    });
    return {
      commit: sha.trim(),
      updated: formatDate(date.trim())
    };
  } catch {
    return null;
  }
}

function formatDate(value: string): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeName(name: string): string {
  if (!name) {
    return "Workshop.AI";
  }
  if (name.toLowerCase() === "workshop-ai") {
    return "Workshop.AI";
  }
  return name;
}

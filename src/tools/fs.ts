import path from "node:path";
import fs from "node:fs/promises";
import { applyPatch as applyUnifiedPatch, parsePatch } from "diff";
import { resolveSandboxPath, ensureWorkspaceRoot, toWorkspaceRelative } from "../util/sandboxPath.js";

export interface FsListEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface FsApplyPatchResult {
  applied: boolean;
  summary: string;
  changedFiles: string[];
}

export async function fsList(root: string, inputPath = "."): Promise<{ entries: FsListEntry[] }> {
  const rootReal = await ensureWorkspaceRoot(root);
  const resolved = await resolveSandboxPath(rootReal, inputPath);
  const entries = await fs.readdir(resolved.absolutePath, { withFileTypes: true });
  const output: FsListEntry[] = [];

  for (const entry of entries) {
    const entryPath = path.join(resolved.absolutePath, entry.name);
    if (entry.isDirectory()) {
      output.push({
        name: entry.name,
        path: toWorkspaceRelative(rootReal, entryPath),
        type: "dir"
      });
    } else if (entry.isFile()) {
      const stat = await fs.stat(entryPath);
      output.push({
        name: entry.name,
        path: toWorkspaceRelative(rootReal, entryPath),
        type: "file",
        size: stat.size
      });
    }
  }

  return { entries: output };
}

export async function fsRead(root: string, inputPath: string): Promise<{ path: string; content: string }> {
  const rootReal = await ensureWorkspaceRoot(root);
  const resolved = await resolveSandboxPath(rootReal, inputPath);
  const content = await fs.readFile(resolved.absolutePath, "utf8");
  return { path: resolved.relativePath, content };
}

export async function fsWrite(
  root: string,
  inputPath: string,
  content: string,
  overwrite = false
): Promise<{ path: string; bytesWritten: number }> {
  const rootReal = await ensureWorkspaceRoot(root);
  const resolved = await resolveSandboxPath(rootReal, inputPath);
  const exists = await fileExists(resolved.absolutePath);
  if (exists && !overwrite) {
    throw new Error(`File already exists: ${resolved.relativePath}`);
  }
  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await fs.writeFile(resolved.absolutePath, content, "utf8");
  return { path: resolved.relativePath, bytesWritten: Buffer.byteLength(content, "utf8") };
}

export async function fsApplyPatch(root: string, patch: string): Promise<FsApplyPatchResult> {
  const rootReal = await ensureWorkspaceRoot(root);
  if (!patch || patch.trim().length === 0) {
    return { applied: false, summary: "Patch is empty", changedFiles: [] };
  }

  if (patch.includes("*** Begin Patch") || patch.includes("*** Add File:") || patch.includes("*** Update File:")) {
    return applySimplePatch(rootReal, patch);
  }

  if (patch.includes("diff --git") || patch.includes("--- ") || patch.includes("+++ ")) {
    return applyUnifiedDiff(rootReal, patch);
  }

  return { applied: false, summary: "Unrecognized patch format", changedFiles: [] };
}

async function applySimplePatch(rootReal: string, patch: string): Promise<FsApplyPatchResult> {
  const operations = parseSimplePatch(patch);
  const changedFiles: string[] = [];

  for (const op of operations) {
    const resolved = await resolveSandboxPath(rootReal, op.path);
    if (op.type === "add") {
      if (await fileExists(resolved.absolutePath)) {
        return { applied: false, summary: `Add failed, file exists: ${resolved.relativePath}`, changedFiles };
      }
      await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      await fs.writeFile(resolved.absolutePath, op.content ?? "", "utf8");
    } else if (op.type === "update") {
      if (!(await fileExists(resolved.absolutePath))) {
        return { applied: false, summary: `Update failed, file missing: ${resolved.relativePath}`, changedFiles };
      }
      await fs.writeFile(resolved.absolutePath, op.content ?? "", "utf8");
    } else if (op.type === "delete") {
      if (!(await fileExists(resolved.absolutePath))) {
        return { applied: false, summary: `Delete failed, file missing: ${resolved.relativePath}`, changedFiles };
      }
      await fs.unlink(resolved.absolutePath);
    }
    changedFiles.push(resolved.relativePath);
  }

  return { applied: true, summary: `Applied ${operations.length} operation(s)`, changedFiles };
}

async function applyUnifiedDiff(rootReal: string, patchText: string): Promise<FsApplyPatchResult> {
  const parsed = parsePatch(patchText);
  if (!parsed.length) {
    return { applied: false, summary: "No patches found", changedFiles: [] };
  }

  const changedFiles: string[] = [];

  for (const patch of parsed) {
    const oldName = stripPrefix(patch.oldFileName || "");
    const newName = stripPrefix(patch.newFileName || "");

    if (newName === "/dev/null" || patch.newFileName === "/dev/null") {
      const resolved = await resolveSandboxPath(rootReal, oldName);
      if (!(await fileExists(resolved.absolutePath))) {
        return { applied: false, summary: `Delete failed, file missing: ${resolved.relativePath}`, changedFiles };
      }
      await fs.unlink(resolved.absolutePath);
      changedFiles.push(resolved.relativePath);
      continue;
    }

    const targetName = newName || oldName;
    const resolved = await resolveSandboxPath(rootReal, targetName);
    const original = (await fileExists(resolved.absolutePath))
      ? await fs.readFile(resolved.absolutePath, "utf8")
      : "";

    const result = applyUnifiedPatch(original, patch);
    if (result === false) {
      return { applied: false, summary: `Failed to apply patch to ${resolved.relativePath}`, changedFiles };
    }

    await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await fs.writeFile(resolved.absolutePath, result, "utf8");
    changedFiles.push(resolved.relativePath);
  }

  return { applied: true, summary: `Applied ${parsed.length} patch(es)`, changedFiles };
}

function stripPrefix(name: string): string {
  if (name.startsWith("a/") || name.startsWith("b/")) {
    return name.slice(2);
  }
  return name;
}

function parseSimplePatch(patch: string): Array<{ type: "add" | "update" | "delete"; path: string; content?: string }> {
  const lines = patch.split(/\r?\n/);
  let index = 0;
  const operations: Array<{ type: "add" | "update" | "delete"; path: string; content?: string }> = [];

  if (lines[index]?.startsWith("*** Begin Patch")) {
    index += 1;
  }

  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.startsWith("*** End Patch")) {
      break;
    }
    if (line.startsWith("*** Add File:")) {
      const filePath = line.replace("*** Add File:", "").trim();
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        contentLines.push(lines[index]);
        index += 1;
      }
      operations.push({ type: "add", path: filePath, content: contentLines.join("\n") });
      continue;
    }
    if (line.startsWith("*** Update File:")) {
      const filePath = line.replace("*** Update File:", "").trim();
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        contentLines.push(lines[index]);
        index += 1;
      }
      operations.push({ type: "update", path: filePath, content: contentLines.join("\n") });
      continue;
    }
    if (line.startsWith("*** Delete File:")) {
      const filePath = line.replace("*** Delete File:", "").trim();
      index += 1;
      operations.push({ type: "delete", path: filePath });
      continue;
    }

    throw new Error(`Unrecognized patch line: ${line}`);
  }

  return operations;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

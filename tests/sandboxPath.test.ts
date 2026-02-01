import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { ensureWorkspaceRoot, resolveSandboxPath } from "../src/util/sandboxPath.js";

async function makeWorkspace(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-test-"));
  const root = path.join(base, "workspace");
  await fs.mkdir(root, { recursive: true });
  return root;
}

describe("sandboxPath", () => {
  it("resolves safe relative paths", async () => {
    const root = await makeWorkspace();
    const rootReal = await ensureWorkspaceRoot(root);
    const resolved = await resolveSandboxPath(rootReal, "notes/plan.txt");
    expect(resolved.absolutePath.startsWith(rootReal)).toBe(true);
    expect(resolved.relativePath).toBe("notes/plan.txt");
  });

  it("rejects traversal paths", async () => {
    const root = await makeWorkspace();
    const rootReal = await ensureWorkspaceRoot(root);
    await expect(resolveSandboxPath(rootReal, "../secrets.txt")).rejects.toThrow();
  });

  it("rejects absolute paths", async () => {
    const root = await makeWorkspace();
    const rootReal = await ensureWorkspaceRoot(root);
    const absolute = path.resolve(rootReal, "..", "outside.txt");
    await expect(resolveSandboxPath(rootReal, absolute)).rejects.toThrow();
  });

  it("rejects symlink escapes when possible", async () => {
    const root = await makeWorkspace();
    const rootReal = await ensureWorkspaceRoot(root);
    const outside = path.join(path.dirname(rootReal), "outside");
    await fs.mkdir(outside, { recursive: true });
    const linkPath = path.join(rootReal, "link");

    try {
      await fs.symlink(outside, linkPath, "junction");
    } catch {
      return;
    }

    await expect(resolveSandboxPath(rootReal, "link/evil.txt")).rejects.toThrow();
  });
});

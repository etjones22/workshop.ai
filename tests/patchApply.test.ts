import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fsApplyPatch } from "../src/tools/fs.js";
import { ensureWorkspaceRoot } from "../src/util/sandboxPath.js";

async function makeWorkspace(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-patch-"));
  const root = path.join(base, "workspace");
  await fs.mkdir(root, { recursive: true });
  return root;
}

describe("fsApplyPatch", () => {
  it("applies simple add/update/delete patches", async () => {
    const root = await makeWorkspace();
    const rootReal = await ensureWorkspaceRoot(root);
    const filePath = path.join(rootReal, "a.txt");
    await fs.writeFile(filePath, "hello", "utf8");

    const patch = [
      "*** Begin Patch",
      "*** Update File: a.txt",
      "hello world",
      "*** Add File: b.txt",
      "new file",
      "*** Delete File: a.txt",
      "*** End Patch"
    ].join("\n");

    const result = await fsApplyPatch(rootReal, patch);
    expect(result.applied).toBe(true);
    expect(result.changedFiles).toContain("b.txt");
    await expect(fs.readFile(path.join(rootReal, "a.txt"), "utf8")).rejects.toThrow();
    const content = await fs.readFile(path.join(rootReal, "b.txt"), "utf8");
    expect(content).toBe("new file");
  });

  it("applies unified diff patches", async () => {
    const root = await makeWorkspace();
    const rootReal = await ensureWorkspaceRoot(root);
    const filePath = path.join(rootReal, "c.txt");
    await fs.writeFile(filePath, "one\nTwo\n", "utf8");

    const patch = [
      "diff --git a/c.txt b/c.txt",
      "--- a/c.txt",
      "+++ b/c.txt",
      "@@ -1,2 +1,2 @@",
      "-one",
      "-Two",
      "+one",
      "+Three"
    ].join("\n");

    const result = await fsApplyPatch(rootReal, patch);
    expect(result.applied).toBe(true);
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("one\nThree\n");
  });
});

import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fsApplyPatch, fsRead, fsWrite } from "../src/tools/fs.js";

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-fs-"));
  await fs.mkdir(path.join(dir, "workspace"), { recursive: true });
  return path.join(dir, "workspace");
}

describe("fs_apply_patch", () => {
  it("adds, updates, and deletes files", async () => {
    const root = await makeWorkspace();
    const addPatch = [
      "*** Begin Patch",
      "*** Add File: notes.txt",
      "Hello",
      "*** End Patch"
    ].join("\n");

    const addResult = await fsApplyPatch(root, addPatch);
    expect(addResult.applied).toBe(true);
    const added = await fsRead(root, "notes.txt");
    expect(added.content).toBe("Hello");

    const updatePatch = [
      "*** Begin Patch",
      "*** Update File: notes.txt",
      "Updated",
      "*** End Patch"
    ].join("\n");
    const updateResult = await fsApplyPatch(root, updatePatch);
    expect(updateResult.applied).toBe(true);
    const updated = await fsRead(root, "notes.txt");
    expect(updated.content).toBe("Updated");

    const deletePatch = [
      "*** Begin Patch",
      "*** Delete File: notes.txt",
      "*** End Patch"
    ].join("\n");
    const deleteResult = await fsApplyPatch(root, deletePatch);
    expect(deleteResult.applied).toBe(true);
  });
});

describe("fs_write", () => {
  it("respects overwrite flag", async () => {
    const root = await makeWorkspace();
    await fsWrite(root, "file.txt", "one", false);
    await expect(fsWrite(root, "file.txt", "two", false)).rejects.toThrow();
    const result = await fsWrite(root, "file.txt", "two", true);
    expect(result.bytesWritten).toBeGreaterThan(0);
  });
});
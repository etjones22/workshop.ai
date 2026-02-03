import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type UpdateStatus =
  | "up-to-date"
  | "update-available"
  | "dirty"
  | "not-git"
  | "no-remote"
  | "git-missing"
  | "error";

export interface UpdateCheckResult {
  status: UpdateStatus;
  message?: string;
  localSha?: string;
  remoteSha?: string;
  branch?: string;
  behind?: number;
  ahead?: number;
  dirty?: boolean;
}

export async function checkForUpdates(repoDir: string): Promise<UpdateCheckResult> {
  const git = await createGitRunner(repoDir);
  if (!git) {
    return { status: "git-missing", message: "git is not available on PATH" };
  }

  const isRepo = await git(["rev-parse", "--is-inside-work-tree"]).catch(() => "");
  if (isRepo.trim() !== "true") {
    return { status: "not-git", message: "Not a git repository" };
  }

  const originUrl = await git(["remote", "get-url", "origin"]).catch(() => "");
  if (!originUrl) {
    return { status: "no-remote", message: "No origin remote configured" };
  }

  const dirty = await git(["status", "--porcelain"]).catch(() => "");
  const isDirty = dirty.trim().length > 0;

  await git(["fetch", "--quiet", "origin"]).catch((err) => {
    throw new Error(`Failed to fetch origin: ${err}`);
  });

  const localSha = await git(["rev-parse", "HEAD"]).catch(() => "");
  if (!localSha) {
    return { status: "error", message: "Unable to resolve local HEAD" };
  }

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD");
  const remoteRef = await resolveRemoteRef(git, branch);
  if (!remoteRef) {
    return { status: "error", message: "Unable to resolve remote branch" };
  }

  const remoteSha = await git(["rev-parse", remoteRef]).catch(() => "");
  if (!remoteSha) {
    return { status: "error", message: "Unable to resolve remote HEAD" };
  }

  const counts = await git(["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`]).catch(() => "");
  const [ahead, behind] = counts
    .trim()
    .split(/\s+/)
    .map((value) => parseInt(value, 10))
    .map((value) => (Number.isNaN(value) ? 0 : value));

  if (behind > 0) {
    return { status: "update-available", localSha, remoteSha, branch, behind, ahead, dirty: isDirty };
  }

  return { status: "up-to-date", localSha, remoteSha, branch, behind, ahead, dirty: isDirty };
}

export async function applyUpdate(repoDir: string): Promise<{ success: boolean; message?: string }> {
  const git = await createGitRunner(repoDir);
  if (!git) {
    return { success: false, message: "git is not available on PATH" };
  }

  try {
    await git(["pull", "--ff-only"]);
    return { success: true };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

export async function applyUpdateWithStash(
  repoDir: string
): Promise<{ success: boolean; message?: string }> {
  const git = await createGitRunner(repoDir);
  if (!git) {
    return { success: false, message: "git is not available on PATH" };
  }

  try {
    await git(["stash", "push", "-u", "-m", "workshop-auto-update"]);
    await git(["pull", "--ff-only"]);
    const popResult = await git(["stash", "pop"]).catch((err) => {
      throw new Error(`Update applied but stash pop failed: ${err}`);
    });
    return { success: true, message: popResult };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

export async function applyForceUpdate(repoDir: string): Promise<{ success: boolean; message?: string }> {
  const git = await createGitRunner(repoDir);
  if (!git) {
    return { success: false, message: "git is not available on PATH" };
  }

  try {
    await git(["fetch", "origin"]);
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD");
    const remoteRef = await resolveRemoteRef(git, branch);
    const target = remoteRef ?? "origin/main";
    await git(["reset", "--hard", target]);
    await git(["clean", "-fd"]);
    return { success: true };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

async function createGitRunner(repoDir: string) {
  try {
    await execFileAsync("git", ["--version"], { cwd: repoDir, windowsHide: true });
  } catch (err) {
    return null;
  }

  return async (args: string[]) => {
    const { stdout } = await execFileAsync("git", args, { cwd: repoDir, windowsHide: true });
    return stdout.trim();
  };
}

async function resolveRemoteRef(git: (args: string[]) => Promise<string>, branch: string): Promise<string | null> {
  if (branch && branch !== "HEAD") {
    const ref = `origin/${branch}`;
    const exists = await git(["show-ref", "--verify", "--quiet", `refs/remotes/${ref}`]).then(
      () => true,
      () => false
    );
    if (exists) {
      return ref;
    }
  }

  const originHead = await git(["symbolic-ref", "refs/remotes/origin/HEAD"]).catch(() => "");
  if (originHead) {
    const match = originHead.trim().replace("refs/remotes/", "");
    return match || null;
  }

  return null;
}

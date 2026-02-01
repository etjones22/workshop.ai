import path from "node:path";
import fs from "node:fs/promises";
function toPosix(p) {
    return p.split(path.sep).join("/");
}
function assertRelativeSafe(inputPath) {
    if (!inputPath || inputPath.trim().length === 0) {
        throw new Error("Path is required");
    }
    if (path.isAbsolute(inputPath)) {
        throw new Error("Absolute paths are not allowed");
    }
    if (inputPath.startsWith("\\\\")) {
        throw new Error("UNC paths are not allowed");
    }
    if (inputPath.includes(":")) {
        throw new Error("Drive-qualified paths are not allowed");
    }
}
function ensureWithin(rootReal, candidate) {
    const rel = path.relative(rootReal, candidate);
    if (rel === "") {
        return;
    }
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error("Path escapes workspace root");
    }
}
export async function ensureWorkspaceRoot(root) {
    await fs.mkdir(root, { recursive: true });
    return fs.realpath(root);
}
export async function resolveSandboxPath(root, inputPath) {
    assertRelativeSafe(inputPath);
    const rootReal = await fs.realpath(root);
    const resolved = path.resolve(rootReal, inputPath);
    try {
        const targetReal = await fs.realpath(resolved);
        ensureWithin(rootReal, targetReal);
    }
    catch (err) {
        if (err.code !== "ENOENT") {
            throw err;
        }
        let parent = path.dirname(resolved);
        while (true) {
            try {
                const parentReal = await fs.realpath(parent);
                ensureWithin(rootReal, parentReal);
                break;
            }
            catch (innerErr) {
                if (innerErr.code !== "ENOENT") {
                    throw innerErr;
                }
                const nextParent = path.dirname(parent);
                if (nextParent === parent) {
                    throw innerErr;
                }
                parent = nextParent;
            }
        }
    }
    ensureWithin(rootReal, resolved);
    const relativePath = toPosix(path.relative(rootReal, resolved));
    return {
        root: rootReal,
        absolutePath: resolved,
        relativePath
    };
}
export function toWorkspaceRelative(root, absolutePath) {
    const rel = path.relative(root, absolutePath);
    return toPosix(rel);
}

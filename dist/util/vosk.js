import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import unzipper from "unzipper";
const execFileAsync = promisify(execFile);
const DEFAULT_MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip";
export async function ensureVoskRuntime(options) {
    const python = await findPython();
    if (!python) {
        throw new Error("Python not found on PATH. Install Python to use Vosk.");
    }
    const venvDir = path.join(options.baseDir, ".workshop", "venv");
    const venvPython = getVenvPythonPath(venvDir);
    if (!(await pathExists(venvPython))) {
        options.onStatus?.("Setting up Python environment for Vosk...");
        await execFileAsync(python, ["-m", "venv", venvDir], { windowsHide: true });
    }
    const hasVosk = await checkVoskInstalled(venvPython);
    if (!hasVosk) {
        options.onStatus?.("Installing Vosk runtime (Python)...");
        await execFileAsync(venvPython, ["-m", "pip", "install", "vosk"], { windowsHide: true });
    }
    const modelPath = await ensureVoskModel(options);
    return { pythonPath: venvPython, modelPath };
}
export async function transcribeWithVosk(runtime, wavPath) {
    const scriptPath = path.join(process.cwd(), "scripts", "vosk_transcribe.py");
    if (!(await pathExists(scriptPath))) {
        throw new Error("Missing vosk_transcribe.py script");
    }
    const { stdout } = await execFileAsync(runtime.pythonPath, [scriptPath, "--model", runtime.modelPath, "--input", wavPath], {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8"
        }
    });
    return stdout.trim();
}
async function ensureVoskModel(options) {
    const baseDir = path.join(options.baseDir, ".workshop", "vosk");
    const modelsDir = path.join(baseDir, "models");
    const metaPath = path.join(baseDir, "model.json");
    const modelUrl = process.env.VOSK_MODEL_URL ?? DEFAULT_MODEL_URL;
    await fs.mkdir(modelsDir, { recursive: true });
    const remoteMeta = await fetchRemoteMeta(modelUrl);
    const localMeta = await readLocalMeta(metaPath);
    if (localMeta && localMeta.modelDir) {
        const existingPath = path.join(modelsDir, localMeta.modelDir);
        if (await pathExists(existingPath)) {
            if (isMetaUpToDate(localMeta, remoteMeta, modelUrl)) {
                return existingPath;
            }
        }
    }
    options.onStatus?.("Downloading Vosk model...");
    const zipPath = path.join(baseDir, "model.zip");
    await downloadWithProgress(modelUrl, zipPath, options.progress);
    const tempDir = path.join(baseDir, `tmp-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await extractZipToDir(zipPath, tempDir);
    const modelDirName = await findExtractedModelDir(tempDir);
    if (!modelDirName) {
        throw new Error("Failed to locate extracted Vosk model directory");
    }
    const finalModelPath = path.join(modelsDir, modelDirName);
    await fs.rm(finalModelPath, { recursive: true, force: true });
    await fs.rename(path.join(tempDir, modelDirName), finalModelPath);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(zipPath, { force: true });
    const meta = {
        url: modelUrl,
        etag: remoteMeta?.etag,
        lastModified: remoteMeta?.lastModified,
        modelDir: modelDirName,
        downloadedAt: new Date().toISOString()
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
    return finalModelPath;
}
async function downloadWithProgress(url, dest, progress) {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
        throw new Error(`Failed to download model: ${response.status}`);
    }
    const total = parseInt(response.headers.get("content-length") || "0", 10);
    const out = createWriteStream(dest);
    let received = 0;
    const stream = Readable.fromWeb(response.body);
    stream.on("data", (chunk) => {
        received += chunk.length;
        progress?.update(received, total);
    });
    await pipeline(stream, out);
    progress?.update(total || received, total || received);
    progress?.done();
}
async function extractZipToDir(zipPath, destDir) {
    const directory = await unzipper.Open.file(zipPath);
    const baseResolved = path.resolve(destDir);
    for (const entry of directory.files) {
        const resolved = resolveZipEntryPath(baseResolved, entry.path);
        if (!resolved) {
            continue;
        }
        if (entry.type === "Directory") {
            await fs.mkdir(resolved, { recursive: true });
            continue;
        }
        if (entry.type !== "File") {
            continue;
        }
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await pipeline(entry.stream(), createWriteStream(resolved));
    }
}
function resolveZipEntryPath(baseResolved, entryPath) {
    const cleaned = entryPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!cleaned || cleaned.includes("..")) {
        return null;
    }
    const resolved = path.resolve(baseResolved, cleaned);
    if (resolved === baseResolved || resolved.startsWith(`${baseResolved}${path.sep}`)) {
        return resolved;
    }
    return null;
}
async function findExtractedModelDir(tempDir) {
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const dir = entries.find((entry) => entry.isDirectory());
    return dir?.name ?? null;
}
async function fetchRemoteMeta(url) {
    try {
        const response = await fetch(url, { method: "HEAD" });
        if (!response.ok) {
            return null;
        }
        return {
            etag: response.headers.get("etag") ?? undefined,
            lastModified: response.headers.get("last-modified") ?? undefined
        };
    }
    catch {
        return null;
    }
}
function isMetaUpToDate(localMeta, remoteMeta, modelUrl) {
    if (localMeta.url !== modelUrl) {
        return false;
    }
    if (!remoteMeta) {
        return true;
    }
    if (remoteMeta.etag && localMeta.etag) {
        return remoteMeta.etag === localMeta.etag;
    }
    if (remoteMeta.lastModified && localMeta.lastModified) {
        return remoteMeta.lastModified === localMeta.lastModified;
    }
    return false;
}
async function readLocalMeta(metaPath) {
    try {
        const content = await fs.readFile(metaPath, "utf8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
async function checkVoskInstalled(pythonPath) {
    try {
        await execFileAsync(pythonPath, ["-c", "import vosk; print(vosk.__version__)"], {
            windowsHide: true
        });
        return true;
    }
    catch {
        return false;
    }
}
function getVenvPythonPath(venvDir) {
    if (process.platform === "win32") {
        return path.join(venvDir, "Scripts", "python.exe");
    }
    return path.join(venvDir, "bin", "python");
}
async function findPython() {
    const envPython = process.env.PYTHON_BIN;
    if (envPython && (await pathExists(envPython))) {
        return envPython;
    }
    if (await canExecute("python", ["--version"])) {
        return "python";
    }
    if (await canExecute("py", ["--version"])) {
        return "py";
    }
    return null;
}
async function canExecute(cmd, args) {
    try {
        await execFileAsync(cmd, args, { windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}
async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    }
    catch {
        return false;
    }
}

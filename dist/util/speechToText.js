import path from "node:path";
import fs from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { GlobalKeyboardListener } from "node-global-key-listener";
import { ensureVoskRuntime, transcribeWithVosk } from "./vosk.js";
const execFileAsync = promisify(execFile);
export function createPushToTalk(options) {
    const baseDir = options.workDir ?? process.cwd();
    const pttDir = path.join(baseDir, ".workshop", "ptt");
    const keyListener = new GlobalKeyboardListener();
    let listener = null;
    let recordingProcess = null;
    let recordingPath = null;
    let isBusy = false;
    let recorderCmd = null;
    let voskRuntime = null;
    const sttEngine = (process.env.STT_ENGINE ?? "vosk").toLowerCase();
    const start = async () => {
        if (listener) {
            return;
        }
        if (sttEngine === "vosk" || sttEngine === "auto") {
            try {
                voskRuntime = await ensureVoskRuntime({
                    baseDir,
                    onStatus: options.onStatus,
                    progress: options.progress
                });
            }
            catch (err) {
                options.onError?.(String(err));
                if (sttEngine === "vosk") {
                    return;
                }
            }
        }
        listener = (event, down) => {
            const ctrlDown = !!(down["LEFT CTRL"] || down["RIGHT CTRL"]);
            const metaDown = !!(down["LEFT META"] || down["RIGHT META"]);
            if (!recordingProcess && !isBusy && ctrlDown && metaDown && event.state === "DOWN") {
                void startRecording();
                return;
            }
            if (recordingProcess && (!ctrlDown || !metaDown)) {
                void stopRecording();
            }
        };
        await keyListener.addListener(listener);
    };
    const stop = async () => {
        if (listener) {
            keyListener.removeListener(listener);
            listener = null;
        }
        if (recordingProcess) {
            await stopRecording();
        }
        keyListener.kill();
    };
    const isRecording = () => recordingProcess !== null;
    const startRecording = async () => {
        if (recordingProcess || isBusy) {
            return;
        }
        isBusy = true;
        try {
            if (!recorderCmd) {
                recorderCmd = await resolveRecorderCommand();
            }
            if (!recorderCmd) {
                options.onError?.("Recorder not found. Install sox and ensure it is on PATH, or set SOX_BIN/REC_BIN.");
                return;
            }
            await fs.mkdir(pttDir, { recursive: true });
            recordingPath = path.join(pttDir, `ptt-${Date.now()}.wav`);
            recordingProcess = spawn(recorderCmd.bin, recorderCmd.args(recordingPath), {
                windowsHide: true,
                stdio: "ignore"
            });
            options.onStatus?.("Listening... (release Ctrl+Win to stop)");
            recordingProcess.once("error", (err) => {
                options.onError?.(`Recording failed: ${String(err)}`);
            });
            recordingProcess.once("exit", async () => {
                recordingProcess = null;
                if (recordingPath) {
                    const pathToTranscribe = recordingPath;
                    recordingPath = null;
                    await transcribe(pathToTranscribe);
                }
            });
        }
        finally {
            isBusy = false;
        }
    };
    const stopRecording = async () => {
        if (!recordingProcess) {
            return;
        }
        options.onStatus?.("Transcribing...");
        try {
            recordingProcess.kill("SIGINT");
        }
        catch {
            try {
                recordingProcess.kill();
            }
            catch {
                // ignore
            }
        }
    };
    const transcribe = async (wavPath) => {
        if (isBusy) {
            return;
        }
        isBusy = true;
        try {
            if ((sttEngine === "vosk" || sttEngine === "auto") && voskRuntime) {
                const text = await transcribeWithVosk(voskRuntime, wavPath);
                const cleaned = text.trim();
                if (cleaned.length > 0) {
                    options.onTranscript(cleaned);
                }
                await safeCleanup([wavPath]);
                return;
            }
            const whisper = await resolveWhisperCommand();
            if (!whisper) {
                options.onError?.("No STT engine available. Configure Vosk (default) or set WHISPER_CPP_BIN and WHISPER_CPP_MODEL.");
                return;
            }
            const outBase = wavPath.replace(/\.wav$/i, "");
            await execFileAsync(whisper.bin, ["-m", whisper.model, "-f", wavPath, "-otxt", "-of", outBase], {
                windowsHide: true
            });
            const txtPath = `${outBase}.txt`;
            const text = await fs.readFile(txtPath, "utf8");
            const cleaned = text.trim();
            if (cleaned.length > 0) {
                options.onTranscript(cleaned);
            }
            await safeCleanup([wavPath, txtPath]);
        }
        catch (err) {
            options.onError?.(`Transcription failed: ${String(err)}`);
        }
        finally {
            isBusy = false;
        }
    };
    return { start, stop, isRecording };
}
async function resolveRecorderCommand() {
    const envSox = process.env.SOX_BIN;
    if (envSox && (await isExecutable(envSox))) {
        return {
            bin: envSox,
            args: (outputPath) => ["-q", "-d", "-r", "16000", "-c", "1", "-b", "16", outputPath]
        };
    }
    const envRec = process.env.REC_BIN;
    if (envRec && (await isExecutable(envRec))) {
        return {
            bin: envRec,
            args: (outputPath) => ["-q", "-r", "16000", "-c", "1", "-b", "16", outputPath]
        };
    }
    if (await isExecutable("sox")) {
        return {
            bin: "sox",
            args: (outputPath) => ["-q", "-d", "-r", "16000", "-c", "1", "-b", "16", outputPath]
        };
    }
    if (await isExecutable("rec")) {
        return {
            bin: "rec",
            args: (outputPath) => ["-q", "-r", "16000", "-c", "1", "-b", "16", outputPath]
        };
    }
    return null;
}
async function resolveWhisperCommand() {
    const bin = process.env.WHISPER_CPP_BIN;
    const model = process.env.WHISPER_CPP_MODEL;
    if (!bin || !model) {
        return null;
    }
    try {
        await fs.access(bin);
        await fs.access(model);
        return { bin, model };
    }
    catch {
        return null;
    }
}
async function isExecutable(command) {
    try {
        await execFileAsync(command, ["--version"], { windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}
async function safeCleanup(paths) {
    await Promise.all(paths.map(async (filePath) => {
        try {
            await fs.unlink(filePath);
        }
        catch {
            // ignore
        }
    }));
}

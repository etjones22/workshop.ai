import { stdout } from "node:process";
import { stripAnsi } from "./colors.js";
export function createProgressBar(label, options) {
    const width = options?.width ?? 28;
    if (!stdout.isTTY) {
        return {
            update: () => { },
            done: () => { }
        };
    }
    let lastRender = 0;
    let lastLineLength = 0;
    const render = (received, total) => {
        const now = Date.now();
        if (now - lastRender < 80 && received < total) {
            return;
        }
        lastRender = now;
        const percent = total > 0 ? Math.min(received / total, 1) : 0;
        const filled = total > 0 ? Math.round(percent * width) : 0;
        const bar = `[${"=".repeat(filled)}${" ".repeat(width - filled)}]`;
        const meta = total > 0 ? `${Math.floor(percent * 100)}%` : formatBytes(received);
        const line = `${label} ${bar} ${meta}`;
        lastLineLength = stripAnsi(line).length;
        stdout.write(`\r${line}`);
    };
    const done = () => {
        if (!stdout.isTTY) {
            return;
        }
        stdout.write(`\r${" ".repeat(lastLineLength)}\r`);
    };
    return {
        update: render,
        done
    };
}
function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
        return `${kb.toFixed(1)} KB`;
    }
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
}

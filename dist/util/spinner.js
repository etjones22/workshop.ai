import { stdout } from "node:process";
import { stripAnsi } from "./colors.js";
const frames = ["|", "/", "-", "\\"];
export function createSpinner(text, options) {
    if (!stdout.isTTY) {
        return {
            start: () => { },
            stop: () => { },
            isSpinning: () => false
        };
    }
    let timer = null;
    let frameIndex = 0;
    const render = () => {
        const frame = frames[frameIndex];
        frameIndex = (frameIndex + 1) % frames.length;
        const frameOut = options?.frameColor ? options.frameColor(frame) : frame;
        const textOut = options?.textColor ? options.textColor(text) : text;
        stdout.write(`\r${frameOut} ${textOut}`);
    };
    const start = () => {
        if (timer) {
            return;
        }
        render();
        timer = setInterval(render, 120);
    };
    const stop = () => {
        if (!timer) {
            return;
        }
        clearInterval(timer);
        timer = null;
        const clearWidth = stripAnsi(text).length + 2;
        stdout.write(`\r${" ".repeat(clearWidth)}\r`);
    };
    return {
        start,
        stop,
        isSpinning: () => timer !== null
    };
}

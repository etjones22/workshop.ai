import { stdout } from "node:process";
const frames = ["|", "/", "-", "\\"];
export function createSpinner(text) {
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
        stdout.write(`\r${frame} ${text}`);
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
        const clearWidth = text.length + 2;
        stdout.write(`\r${" ".repeat(clearWidth)}\r`);
    };
    return {
        start,
        stop,
        isSpinning: () => timer !== null
    };
}

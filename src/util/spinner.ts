import { stdout } from "node:process";
import { stripAnsi } from "./colors.js";

export interface Spinner {
  start: () => void;
  stop: () => void;
  isSpinning: () => boolean;
}

const frames = ["|", "/", "-", "\\"];

export function createSpinner(
  text: string,
  options?: { frameColor?: (text: string) => string; textColor?: (text: string) => string }
): Spinner {
  if (!stdout.isTTY) {
    return {
      start: () => {},
      stop: () => {},
      isSpinning: () => false
    };
  }

  let timer: NodeJS.Timeout | null = null;
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

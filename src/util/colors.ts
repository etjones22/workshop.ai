import { stdout } from "node:process";

type ColorFn = (text: string) => string;

const supportsColor = (() => {
  if (process.env.NO_COLOR) {
    return false;
  }
  if (process.env.FORCE_COLOR) {
    return true;
  }
  if (process.env.TERM === "dumb") {
    return false;
  }
  return stdout.isTTY === true;
})();

const wrap = (code: string): ColorFn => {
  if (!supportsColor) {
    return (text: string) => text;
  }
  return (text: string) => `\x1b[${code}m${text}\x1b[0m`;
};

// Nord-inspired palette (ANSI 256-color approximations)
export const colors = {
  prompt: wrap("38;5;110"), // Nord8
  assistant: wrap("38;5;253"), // Nord4
  tool: wrap("38;5;109"), // Nord7
  info: wrap("38;5;111"), // Nord9
  warn: wrap("38;5;222"), // Nord13
  error: wrap("38;5;167"), // Nord11
  spinner: wrap("38;5;139"), // Nord15
  success: wrap("38;5;150"), // Nord14
  dim: wrap("2")
};

export function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, "");
}

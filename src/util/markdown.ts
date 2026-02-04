import { marked } from "marked";
import TerminalRenderer from "marked-terminal";

const renderer = new TerminalRenderer({
  reflowText: false,
  width: 80,
  tab: 2
}) as unknown as import("marked").Renderer;

marked.setOptions({ renderer });

export function renderMarkdownToAnsi(text: string): string {
  return marked.parse(text) as string;
}

export interface MarkdownStreamRenderer {
  push: (chunk: string) => string;
  flush: () => string;
  reset: () => void;
}

export function createMarkdownStreamRenderer(): MarkdownStreamRenderer {
  let buffer = "";
  let inCodeFence = false;

  const push = (chunk: string): string => {
    if (!chunk) {
      return "";
    }
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    const rendered: string[] = [];
    for (const line of lines) {
      rendered.push(renderLine(line, () => (inCodeFence = !inCodeFence), inCodeFence));
    }
    return rendered.join("\n") + (lines.length > 0 ? "\n" : "");
  };

  const flush = (): string => {
    if (!buffer) {
      return "";
    }
    const line = buffer;
    buffer = "";
    return renderLine(line, () => (inCodeFence = !inCodeFence), inCodeFence);
  };

  const reset = (): void => {
    buffer = "";
    inCodeFence = false;
  };

  return { push, flush, reset };
}

function renderLine(line: string, toggleFence: () => void, inFence: boolean): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("```")) {
    toggleFence();
    return "";
  }
  if (inFence) {
    return line;
  }
  let output = line;
  output = output.replace(/^#{1,6}\s+/, "");
  output = output.replace(/\*\*(.+?)\*\*/g, "$1");
  output = output.replace(/__(.+?)__/g, "$1");
  output = output.replace(/`([^`]+)`/g, "$1");
  output = output.replace(/\*(\S[^*]*\S)\*/g, "$1");
  output = output.replace(/_(\S[^_]*\S)_/g, "$1");
  return output;
}

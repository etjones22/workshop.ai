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

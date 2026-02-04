import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
const renderer = new TerminalRenderer({
    reflowText: false,
    width: 80,
    tab: 2
});
marked.setOptions({ renderer });
export function renderMarkdownToAnsi(text) {
    return marked.parse(text);
}
export function createMarkdownStreamRenderer() {
    let buffer = "";
    let inCodeFence = false;
    const push = (chunk) => {
        if (!chunk) {
            return "";
        }
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const rendered = [];
        for (const line of lines) {
            rendered.push(renderLine(line, () => (inCodeFence = !inCodeFence), inCodeFence));
        }
        return rendered.join("\n") + (lines.length > 0 ? "\n" : "");
    };
    const flush = () => {
        if (!buffer) {
            return "";
        }
        const line = buffer;
        buffer = "";
        return renderLine(line, () => (inCodeFence = !inCodeFence), inCodeFence);
    };
    const reset = () => {
        buffer = "";
        inCodeFence = false;
    };
    return { push, flush, reset };
}
function renderLine(line, toggleFence, inFence) {
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

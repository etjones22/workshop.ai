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

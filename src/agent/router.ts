import type { AgentProfile } from "./agents.js";
import { emailWriterAgent } from "./agents.js";

export interface RoutedAgent {
  agent: AgentProfile;
  reason: string;
}

export function routeAgent(request: string): RoutedAgent | null {
  const text = request.toLowerCase();
  if (isEmailDraftRequest(text)) {
    return { agent: emailWriterAgent, reason: "Email drafting intent detected" };
  }
  return null;
}

function isEmailDraftRequest(text: string): boolean {
  const hasEmailWord = /\b(e-?mail)\b/.test(text);
  const hasEmailIntent = /\b(draft|reply|respond|compose|write)\b/.test(text);
  if (hasEmailWord && hasEmailIntent) {
    return true;
  }
  if (text.includes("draft a reply") || text.includes("write a reply") || text.includes("reply to")) {
    return true;
  }
  if (text.includes("write an email") || text.includes("compose an email")) {
    return true;
  }
  return false;
}

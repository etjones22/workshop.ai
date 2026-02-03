import { emailWriterAgent } from "./agents.js";
export function routeAgent(request) {
    const text = request.toLowerCase();
    if (isEmailDraftRequest(text)) {
        return { agent: emailWriterAgent, reason: "Email drafting intent detected" };
    }
    return null;
}
function isEmailDraftRequest(text) {
    if (text.includes("email") || text.includes("e-mail")) {
        if (text.includes("draft") || text.includes("reply") || text.includes("respond") || text.includes("compose")) {
            return true;
        }
    }
    if (text.includes("draft a reply") || text.includes("write a reply") || text.includes("reply to")) {
        return true;
    }
    if (text.includes("write an email") || text.includes("compose an email")) {
        return true;
    }
    return false;
}

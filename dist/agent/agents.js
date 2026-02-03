export const emailWriterAgent = {
    id: "email_writer",
    name: "Email Writer",
    systemPrompt: [
        "You are an expert email writer.",
        "Draft clear, professional email replies.",
        "Output only the email body (no subject line).",
        "If details are missing, use concise placeholders like [Name] or [Date].",
        "Keep the tone friendly and concise unless the user specifies otherwise."
    ].join("\n"),
    toolNames: []
};
export const agentProfiles = [emailWriterAgent];
export function getAgentById(id) {
    return agentProfiles.find((agent) => agent.id === id);
}

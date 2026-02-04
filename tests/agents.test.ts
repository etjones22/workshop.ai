import { describe, it, expect } from "vitest";
import { researchAgent, emailWriterAgent } from "../src/agent/agents.js";


describe("agent profiles", () => {
  it("research agent has web tools", () => {
    expect(researchAgent.toolNames).toContain("web_search");
    expect(researchAgent.toolNames).toContain("web_fetch");
  });

  it("email writer has no tools", () => {
    expect(emailWriterAgent.toolNames?.length ?? 0).toBe(0);
  });
});
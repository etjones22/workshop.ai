import { describe, it, expect } from "vitest";
import { routeAgent } from "../src/agent/router.js";

const cases: Array<{ input: string; expected: string | null }> = [
  { input: "write me a email about the project", expected: "email_writer" },
  { input: "draft an email to the team", expected: "email_writer" },
  { input: "research the latest on solar panels", expected: "research" },
  { input: "deep dive on battery tech", expected: "research" },
  { input: "just say hello", expected: null }
];

describe("agent router", () => {
  for (const testCase of cases) {
    it(`routes: ${testCase.input}`, () => {
      const routed = routeAgent(testCase.input);
      expect(routed?.agent.id ?? null).toBe(testCase.expected);
    });
  }
});
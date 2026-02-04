import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { loadConfig, mergeConfig, DEFAULT_CONFIG } from "../src/util/config.js";

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-config-"));
  return dir;
}

describe("config loader", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("merges defaults with file config", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "workshop.config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({ agent: { maxSteps: 20 }, speech: { enabled: false } }, null, 2),
      "utf8"
    );

    const config = await loadConfig(dir);
    expect(config.agent.maxSteps).toBe(20);
    expect(config.speech.enabled).toBe(false);
    expect(config.llm.model).toBe(DEFAULT_CONFIG.llm.model);
  });

  it("env overrides config file", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "workshop.config.json");
    await fs.writeFile(configPath, JSON.stringify({ agent: { maxSteps: 20 } }), "utf8");
    process.env.WORKSHOP_MAX_STEPS = "7";

    const config = await loadConfig(dir);
    expect(config.agent.maxSteps).toBe(7);
  });

  it("mergeConfig applies overrides in order", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { agent: { maxSteps: 5 } }, { agent: { maxSteps: 9 } });
    expect(merged.agent.maxSteps).toBe(9);
  });
});
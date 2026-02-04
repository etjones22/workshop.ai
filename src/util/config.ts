import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface WorkshopConfig {
  llm: LlmConfig;
  agent: {
    autoApprove: boolean;
    maxSteps: number;
  };
  updates: {
    checkOnStart: boolean;
  };
  speech: {
    enabled: boolean;
  };
  server: {
    host: string;
    port: number;
    token?: string;
  };
}

export type PartialWorkshopConfig = Partial<{
  llm: Partial<LlmConfig>;
  agent: Partial<WorkshopConfig["agent"]>;
  updates: Partial<WorkshopConfig["updates"]>;
  speech: Partial<WorkshopConfig["speech"]>;
  server: Partial<WorkshopConfig["server"]>;
}>;

export const DEFAULT_CONFIG: WorkshopConfig = {
  llm: {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "gpt-oss:20b"
  },
  agent: {
    autoApprove: false,
    maxSteps: 12
  },
  updates: {
    checkOnStart: true
  },
  speech: {
    enabled: true
  },
  server: {
    host: "0.0.0.0",
    port: 8080,
    token: undefined
  }
};

export async function loadConfig(baseDir: string): Promise<WorkshopConfig> {
  const fileConfig = await readConfigFile(baseDir);
  const envConfig = readEnvConfig();
  return mergeConfig(DEFAULT_CONFIG, fileConfig, envConfig);
}

export function mergeConfig(
  base: WorkshopConfig,
  ...overrides: Array<PartialWorkshopConfig | null | undefined>
): WorkshopConfig {
  const merged: WorkshopConfig = {
    llm: { ...base.llm },
    agent: { ...base.agent },
    updates: { ...base.updates },
    speech: { ...base.speech },
    server: { ...base.server }
  };

  for (const override of overrides) {
    if (!override) {
      continue;
    }
    if (override.llm) {
      if (override.llm.baseUrl !== undefined) {
        merged.llm.baseUrl = override.llm.baseUrl;
      }
      if (override.llm.apiKey !== undefined) {
        merged.llm.apiKey = override.llm.apiKey;
      }
      if (override.llm.model !== undefined) {
        merged.llm.model = override.llm.model;
      }
    }
    if (override.agent) {
      if (override.agent.autoApprove !== undefined) {
        merged.agent.autoApprove = override.agent.autoApprove;
      }
      if (override.agent.maxSteps !== undefined) {
        merged.agent.maxSteps = override.agent.maxSteps;
      }
    }
    if (override.updates) {
      if (override.updates.checkOnStart !== undefined) {
        merged.updates.checkOnStart = override.updates.checkOnStart;
      }
    }
    if (override.speech) {
      if (override.speech.enabled !== undefined) {
        merged.speech.enabled = override.speech.enabled;
      }
    }
    if (override.server) {
      if (override.server.host !== undefined) {
        merged.server.host = override.server.host;
      }
      if (override.server.port !== undefined) {
        merged.server.port = override.server.port;
      }
      if (override.server.token !== undefined) {
        merged.server.token = override.server.token;
      }
    }
  }

  return merged;
}

async function readConfigFile(baseDir: string): Promise<PartialWorkshopConfig | null> {
  const candidates = [
    path.join(baseDir, "workshop.config.json"),
    path.join(baseDir, ".workshop", "config.json"),
    path.join(os.homedir(), ".workshop", "config.json")
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const data = JSON.parse(raw);
      return sanitizeConfig(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      return null;
    }
  }

  return null;
}

function sanitizeConfig(input: unknown): PartialWorkshopConfig {
  if (!input || typeof input !== "object") {
    return {};
  }
  const data = input as Record<string, unknown>;
  const config: PartialWorkshopConfig = {};

  if (isObject(data.llm)) {
    const llm = data.llm as Record<string, unknown>;
    config.llm = {
      baseUrl: asString(llm.baseUrl),
      apiKey: asString(llm.apiKey),
      model: asString(llm.model)
    };
  }

  if (isObject(data.agent)) {
    const agent = data.agent as Record<string, unknown>;
    config.agent = {
      autoApprove: asBoolean(agent.autoApprove),
      maxSteps: asNumber(agent.maxSteps)
    };
  }

  if (isObject(data.updates)) {
    const updates = data.updates as Record<string, unknown>;
    config.updates = {
      checkOnStart: asBoolean(updates.checkOnStart)
    };
  }

  if (isObject(data.speech)) {
    const speech = data.speech as Record<string, unknown>;
    config.speech = {
      enabled: asBoolean(speech.enabled)
    };
  }

  if (isObject(data.server)) {
    const server = data.server as Record<string, unknown>;
    config.server = {
      host: asString(server.host),
      port: asNumber(server.port),
      token: asString(server.token)
    };
  }

  return config;
}

function readEnvConfig(): PartialWorkshopConfig {
  const config: PartialWorkshopConfig = {};

  const baseUrl = envString("WORKSHOP_BASE_URL");
  const apiKey = envString("WORKSHOP_API_KEY");
  const model = envString("WORKSHOP_MODEL");
  if (baseUrl || apiKey || model) {
    config.llm = {
      baseUrl: baseUrl ?? undefined,
      apiKey: apiKey ?? undefined,
      model: model ?? undefined
    };
  }

  const autoApprove = envBoolean("WORKSHOP_AUTO_APPROVE");
  const maxSteps = envNumber("WORKSHOP_MAX_STEPS");
  if (autoApprove !== undefined || maxSteps !== undefined) {
    config.agent = {
      autoApprove,
      maxSteps
    };
  }

  const checkOnStart = envBoolean("WORKSHOP_CHECK_UPDATES");
  if (checkOnStart !== undefined) {
    config.updates = { checkOnStart };
  }

  const speechEnabled = envBoolean("WORKSHOP_SPEECH_ENABLED");
  if (speechEnabled !== undefined) {
    config.speech = { enabled: speechEnabled };
  }

  const serverHost = envString("WORKSHOP_SERVER_HOST");
  const serverPort = envNumber("WORKSHOP_SERVER_PORT");
  const serverToken = envString("WORKSHOP_SERVER_TOKEN");
  if (serverHost || serverPort !== undefined || serverToken) {
    config.server = {
      host: serverHost ?? undefined,
      port: serverPort,
      token: serverToken ?? undefined
    };
  }

  return config;
}

function envString(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : undefined;
}

function envNumber(key: string): number | undefined {
  const value = envString(key);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function envBoolean(key: string): boolean | undefined {
  const value = envString(key);
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (["true", "yes", "1", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "0", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

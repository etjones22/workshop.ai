#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { createAgentSession, runAgent } from "./agent/loop.js";
import { ensureWorkspaceRoot } from "./util/sandboxPath.js";
import { createSpinner } from "./util/spinner.js";
import { applyForceUpdate, applyUpdate, applyUpdateWithStash, checkForUpdates } from "./util/updater.js";
import { colors } from "./util/colors.js";
import { createPushToTalk } from "./util/speechToText.js";
import { createProgressBar } from "./util/progress.js";
import { ConversationStats, estimateTokens } from "./util/stats.js";
import { createMarkdownStreamRenderer, renderMarkdownToAnsi } from "./util/markdown.js";
import { startServer } from "./server/server.js";
import { createRemoteSession } from "./util/remoteClient.js";
import { formatVersionBanner, getVersionInfo } from "./util/version.js";
import { DEFAULT_CONFIG, loadConfig } from "./util/config.js";
import { runHealthChecks } from "./util/health.js";

const program = new Command();
program
  .name("workshop")
  .description("Workshop.AI local tool-using agent")
  .version("0.1.0");

const asciiArt = String.raw`
 __          __        _        _                           _____ 
 \ \        / /       | |      | |                    /\   |_   _|
  \ \  /\  / /__  _ __| | _____| |__   ___  _ __     /  \    | |  
   \ \/  \/ / _ \| '__| |/ / __| '_ \ / _ \| '_ \   / /\ \   | |  
    \  /\  / (_) | |  |   <\__ \ | | | (_) | |_) | / ____ \ _| |_ 
     \/  \/ \___/|_|  |_|\_\___/_| |_|\___/| .__(_)_/    \_\_____|
                                           | |                    
                                           |_|                    
`;

const versionInfo = await getVersionInfo(process.cwd());
printBanner();

program
  .command("init")
  .description("Create workspace and example files")
  .action(async () => {
    try {
      const workspaceRoot = path.join(process.cwd(), "workspace");
      await ensureWorkspaceRoot(workspaceRoot);
      const examplePath = path.join(workspaceRoot, "hello.txt");
      const exists = await fileExists(examplePath);
      if (!exists) {
        await fs.writeFile(
          examplePath,
          "Welcome to Workshop.AI!\n\nThis is your sandbox workspace.\n",
          "utf8"
        );
      }
      console.log(`Workspace ready at ${workspaceRoot}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("config")
  .description("Print the resolved Workshop.AI configuration")
  .action(async () => {
    try {
      const config = await loadConfig(process.cwd());
      console.log(JSON.stringify(config, null, 2));
    } catch (err) {
      console.error(colors.error((err as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command("health")
  .description("Run the Workshop.AI health checks (tests)")
  .action(async () => {
    try {
      console.log(colors.info("Running health checks..."));
      const result = await runHealthChecks(process.cwd());
      if (result.output) {
        console.log(result.output);
      }
      if (result.success) {
        console.log(colors.success("Health checks passed."));
      } else {
        console.error(colors.error("Health checks failed."));
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(colors.error((err as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command("serve")
  .description("Start Workshop.AI server for remote clients")
  .option("--host <host>", "Host to bind", "0.0.0.0")
  .option("--port <port>", "Port to bind", (value) => parseInt(value, 10), 8080)
  .option("--token <token>", "Auth token for remote clients")
  .option("--max-steps <n>", "Max agent steps per request", (value) => parseInt(value, 10), 12)
  .option("--auto-approve", "Auto-approve write tools", false)
  .action(async (
    options: { host?: string; port?: number; token?: string; maxSteps?: number; autoApprove?: boolean },
    command: Command
  ) => {
    try {
      const config = await loadConfig(process.cwd());
      const host = resolveOption(command, "host", options.host, config.server.host);
      const port = resolveOption(command, "port", options.port, config.server.port);
      const maxSteps = resolveOption(command, "maxSteps", options.maxSteps, config.agent.maxSteps);
      const autoApprove = resolveOption(command, "autoApprove", options.autoApprove, config.agent.autoApprove);
      const token = resolveOption(command, "token", options.token, config.server.token);
      await startServer({
        host,
        port,
        token,
        maxSteps,
        autoApprove,
        baseDir: process.cwd(),
        llmConfig: config.llm
      });
      console.log(colors.info(`Workshop.AI server listening on http://${host}:${port}`));
      if (token) {
        console.log(colors.info("Auth token enabled (clients must send Authorization header)."));
      } else {
        console.log(colors.warn("No auth token set. Server is open to anyone on this network."));
      }
    } catch (err) {
      console.error(colors.error((err as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .description("Run the Workshop.AI agent once")
  .argument("<request...>", "User request")
  .option("--auto-approve", "Skip confirmations for write tools", false)
  .option("--max-steps <n>", "Max agent steps", (value) => parseInt(value, 10), 12)
  .option("--check-updates", "Check GitHub for updates on startup", true)
  .option("--remote <url>", "Use a remote Workshop.AI server")
  .option("--token <token>", "Remote auth token")
  .option("--user <id>", "Remote user id")
  .action(
    async (
      requestParts: string[],
      options: {
        autoApprove?: boolean;
        maxSteps?: number;
        remote?: string;
        token?: string;
        user?: string;
      },
      command: Command
    ) => {
    try {
      const config = await loadConfig(process.cwd());
      const request = requestParts.join(" ");
      const autoApprove = resolveOption(command, "autoApprove", options.autoApprove, config.agent.autoApprove);
      const maxSteps = resolveOption(command, "maxSteps", options.maxSteps, config.agent.maxSteps);
      const checkUpdates = resolveOption(
        command,
        "checkUpdates",
        (options as { checkUpdates?: boolean }).checkUpdates,
        config.updates.checkOnStart
      );
      const remote = options.remote;
      const token = options.token;
      const userId = options.user;
      const spinner = createSpinner("Thinking...", { frameColor: colors.spinner, textColor: colors.info });
      const stats = new ConversationStats();
      const handleAgentOutput = makeAgentOutputHandler(spinner);

      if (checkUpdates) {
        const updated = await maybeUpdate(async (question) => {
          const rl = await createChatInterface();
          const answer = await rl.question(question);
          rl.close();
          return parseYesNo(answer);
        });
        if (updated) {
          return;
        }
      }

      if (remote) {
        const remoteSession = createRemoteSession({ baseUrl: remote, token, userId });
        let streamed = false;
        let cleanupEsc: () => void = () => {};
        const streamRenderer = createMarkdownStreamRenderer();
        stats.addInput(request);
        stats.startResponse();
        spinner.start();
        try {
          const controller = new AbortController();
          cleanupEsc = attachEscCancel(controller, () => {
            if (spinner.isSpinning()) {
              spinner.stop();
            }
            console.log(colors.warn("Request cancelled."));
          });
          const response = await remoteSession.send(
            request,
            (tokenChunk) => {
              if (!streamed) {
                streamed = true;
                if (spinner.isSpinning()) {
                  spinner.stop();
                }
              }
              stats.addOutputChunk(tokenChunk);
              const rendered = streamRenderer.push(tokenChunk);
              if (rendered) {
                process.stdout.write(colors.assistant(rendered));
              }
            },
            handleAgentOutput,
            controller.signal
          );
          cleanupEsc();
          spinner.stop();
          if (streamed) {
            const tail = streamRenderer.flush();
            if (tail) {
              process.stdout.write(colors.assistant(tail));
            }
            process.stdout.write("\n");
          } else {
            stats.addOutputChunk(response);
            console.log(renderMarkdownToAnsi(response));
          }
          stats.finishResponse();
          printStats(stats);
        } catch (err) {
          cleanupEsc();
          spinner.stop();
          if (isAbortError(err)) {
            return;
          }
          throw err;
        }
        return;
      }

      let streamed = false;
      const streamRenderer = createMarkdownStreamRenderer();
      const session = await createAgentSession({
        autoApprove,
        maxSteps,
        llmConfig: config.llm,
        confirm: async (question: string) => {
          const wasSpinning = spinner.isSpinning();
          if (wasSpinning) {
            spinner.stop();
          }
          const rl = await createChatInterface();
          const answer = await rl.question(colors.prompt(question));
          rl.close();
          if (wasSpinning) {
            spinner.start();
          }
          const normalized = answer.trim().toLowerCase();
          return normalized === "y" || normalized === "yes";
        },
        onToken: (token: string) => {
          if (!streamed) {
            streamed = true;
            if (spinner.isSpinning()) {
              spinner.stop();
            }
          }
          stats.addOutputChunk(token);
          const rendered = streamRenderer.push(token);
          if (rendered) {
            process.stdout.write(colors.assistant(rendered));
          }
        },
        onAgent: handleAgentOutput
      });

      const controller = new AbortController();
      let cleanupEsc: () => void = () => {};
      cleanupEsc = attachEscCancel(controller, () => {
        if (spinner.isSpinning()) {
          spinner.stop();
        }
        console.log(colors.warn("Request cancelled."));
      });
      spinner.start();
      try {
        stats.addInput(request);
        stats.startResponse();
        const result = await session.runTurn(request, { signal: controller.signal });
        cleanupEsc();
        spinner.stop();
        if (streamed) {
          const tail = streamRenderer.flush();
          if (tail) {
            process.stdout.write(colors.assistant(tail));
          }
          process.stdout.write("\n");
        } else {
          stats.addOutputChunk(result);
          console.log(renderMarkdownToAnsi(result));
        }
        stats.finishResponse();
        printStats(stats);
      } catch (err) {
        cleanupEsc();
        spinner.stop();
        if (isAbortError(err)) {
          return;
        }
        throw err;
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("chat", { isDefault: true })
  .description("Start an interactive chat session")
  .option("--auto-approve", "Skip confirmations for write tools", false)
  .option("--max-steps <n>", "Max agent steps per user turn", (value) => parseInt(value, 10), 12)
  .option("--check-updates", "Check GitHub for updates on startup", true)
  .option("--no-push-to-talk", "Disable push-to-talk (hold Ctrl+Win)")
  .option("--remote <url>", "Use a remote Workshop.AI server")
  .option("--token <token>", "Remote auth token")
  .option("--user <id>", "Remote user id")
  .action(
    async (options: {
      autoApprove?: boolean;
      maxSteps?: number;
      pushToTalk?: boolean;
      remote?: string;
      token?: string;
      user?: string;
    }, command: Command) => {
    try {
      const config = await loadConfig(process.cwd());
      const autoApprove = resolveOption(command, "autoApprove", options.autoApprove, config.agent.autoApprove);
      const maxSteps = resolveOption(command, "maxSteps", options.maxSteps, config.agent.maxSteps);
      const checkUpdates = resolveOption(
        command,
        "checkUpdates",
        (options as { checkUpdates?: boolean }).checkUpdates,
        config.updates.checkOnStart
      );
      let enablePushToTalk = resolveOption(command, "pushToTalk", options.pushToTalk, config.speech.enabled);
      const remote = options.remote;
      const token = options.token;
      const userId = options.user;

      const rl = await createChatInterface();
      if (checkUpdates) {
        const updated = await maybeUpdate(async (question) => parseYesNo(await rl.question(colors.prompt(question))));
        if (updated) {
          rl.close();
          return;
        }
      }
      if (enablePushToTalk) {
        console.log(
          colors.warn(
            "Push-to-talk uses a global hotkey listener (Ctrl+Win) which some antivirus tools flag as keylogger behavior."
          )
        );
        const answer = await rl.question(colors.prompt("Enable push-to-talk for this session? (y/N) "));
        enablePushToTalk = parseYesNo(answer);
        if (!enablePushToTalk) {
          console.log(colors.info("Push-to-talk disabled for this session."));
        }
      }
      const spinner = createSpinner("Thinking...", { frameColor: colors.spinner, textColor: colors.info });
      const stats = new ConversationStats();
      const streamState = { active: false };
      const streamRenderer = createMarkdownStreamRenderer();
      const handleAgentOutput = makeAgentOutputHandler(spinner);
      const remoteSession = remote ? createRemoteSession({ baseUrl: remote, token, userId }) : null;
      const session = remote
        ? null
        : await createAgentSession({
            autoApprove,
            maxSteps,
            llmConfig: config.llm,
            confirm: async (question: string) => {
              const wasSpinning = spinner.isSpinning();
              if (wasSpinning) {
                spinner.stop();
              }
              const answer = await rl.question(colors.prompt(question));
              const normalized = answer.trim().toLowerCase();
              if (wasSpinning) {
                spinner.start();
              }
              return normalized === "y" || normalized === "yes";
            },
            onToken: (tokenChunk: string) => {
              if (!streamState.active) {
                streamState.active = true;
                if (spinner.isSpinning()) {
                  spinner.stop();
                }
              }
              stats.addOutputChunk(tokenChunk);
              const rendered = streamRenderer.push(tokenChunk);
              if (rendered) {
                process.stdout.write(colors.assistant(rendered));
              }
            },
            onAgent: handleAgentOutput
          });

      let ptt: ReturnType<typeof createPushToTalk> | null = null;
      let awaitingInput = false;
      if (enablePushToTalk) {
        const downloadProgress = createProgressBar(colors.info("Downloading Vosk model"));
        ptt = createPushToTalk({
          onTranscript: (text) => {
            const cleaned = text.trim();
            if (!cleaned) {
              return;
            }
            if (!awaitingInput) {
              return;
            }
            if (spinner.isSpinning()) {
              spinner.stop();
            }
            rl.write(`${cleaned}\n`);
          },
          onStatus: (status) => {
            if (spinner.isSpinning()) {
              spinner.stop();
            }
            console.log(colors.info(status));
          },
          onError: (message) => {
            if (spinner.isSpinning()) {
              spinner.stop();
            }
            console.warn(colors.warn(message));
          },
          progress: downloadProgress
        });
        await ptt.start();
        console.log(colors.info("Push-to-talk enabled (hold Ctrl+Win to speak)."));
      }

      console.log(colors.info("Workshop.AI chat. Type /exit to quit, /reset to clear context."));
      for (;;) {
        awaitingInput = true;
        const line = await rl.question(colors.prompt("> "));
        awaitingInput = false;
        const input = line.trim();
        if (!input) {
          continue;
        }
        if (input.startsWith("/research")) {
          const query = input.replace(/^\/research\s*/i, "").trim();
          if (!query) {
            console.log(colors.warn("Usage: /research <topic>"));
            continue;
          }
          streamRenderer.reset();
          const wrapped = `Research: ${query}`;
          streamState.active = false;
          stats.addInput(wrapped);
          stats.startResponse();
          spinner.start();
          let cleanupEsc: () => void = () => {};
          try {
            const controller = new AbortController();
            cleanupEsc = attachEscCancel(controller, () => {
              if (spinner.isSpinning()) {
                spinner.stop();
              }
              console.log(colors.warn("Request cancelled."));
            });
            const response = remoteSession
              ? await remoteSession.send(
                  wrapped,
                  (tokenChunk) => {
                    if (!streamState.active) {
                      streamState.active = true;
                      if (spinner.isSpinning()) {
                        spinner.stop();
                      }
                    }
                    stats.addOutputChunk(tokenChunk);
                    const rendered = streamRenderer.push(tokenChunk);
                    if (rendered) {
                      process.stdout.write(colors.assistant(rendered));
                    }
                  },
                  handleAgentOutput,
                  controller.signal
                )
              : await session!.runTurn(wrapped, { signal: controller.signal });
            cleanupEsc();
            spinner.stop();
            if (streamState.active) {
              const tail = streamRenderer.flush();
              if (tail) {
                process.stdout.write(colors.assistant(tail));
              }
              process.stdout.write("\n");
            } else {
              stats.addOutputChunk(response);
              console.log(renderMarkdownToAnsi(response));
            }
            stats.finishResponse();
            printStats(stats);
          } catch (err) {
            cleanupEsc();
            spinner.stop();
            if (isAbortError(err)) {
              continue;
            }
            throw err;
          }
          continue;
        }
        if (input === "/exit" || input === "/quit") {
          break;
        }
        if (input === "/clear") {
          console.clear();
          printBanner();
          console.log(colors.info("Chat session continues. Type /exit to quit, /reset to clear context."));
          continue;
        }
        if (input === "/version") {
          console.log(colors.info(formatVersionBanner(versionInfo)));
          continue;
        }
        if (input === "/health") {
          const wasSpinning = spinner.isSpinning();
          if (wasSpinning) {
            spinner.stop();
          }
          console.log(colors.info("Running health checks..."));
          const result = await runHealthChecks(process.cwd());
          if (result.output) {
            console.log(result.output);
          }
          if (result.success) {
            console.log(colors.success("Health checks passed."));
          } else {
            console.error(colors.error("Health checks failed."));
          }
          if (wasSpinning) {
            spinner.start();
          }
          continue;
        }
        if (input === "/reset") {
          if (remoteSession) {
            await remoteSession.reset();
          } else if (session) {
            await session.reset();
          }
          stats.reset();
          console.log(colors.info("Session reset."));
          continue;
        }
        streamState.active = false;
        streamRenderer.reset();
        stats.addInput(input);
        stats.startResponse();
        spinner.start();
        let cleanupEsc: () => void = () => {};
        try {
          const controller = new AbortController();
          cleanupEsc = attachEscCancel(controller, () => {
            if (spinner.isSpinning()) {
              spinner.stop();
            }
            console.log(colors.warn("Request cancelled."));
          });
          const response = remoteSession
            ? await remoteSession.send(
                input,
                (tokenChunk) => {
                  if (!streamState.active) {
                    streamState.active = true;
                    if (spinner.isSpinning()) {
                      spinner.stop();
                    }
                  }
                  stats.addOutputChunk(tokenChunk);
                  const rendered = streamRenderer.push(tokenChunk);
                  if (rendered) {
                    process.stdout.write(colors.assistant(rendered));
                  }
                },
                handleAgentOutput,
                controller.signal
              )
            : await session!.runTurn(input, { signal: controller.signal });
          cleanupEsc();
          spinner.stop();
          if (streamState.active) {
            const tail = streamRenderer.flush();
            if (tail) {
              process.stdout.write(colors.assistant(tail));
            }
            process.stdout.write("\n");
          } else {
            stats.addOutputChunk(response);
            console.log(renderMarkdownToAnsi(response));
          }
          stats.finishResponse();
          printStats(stats);
        } catch (err) {
          cleanupEsc();
          spinner.stop();
          if (isAbortError(err)) {
            continue;
          }
          throw err;
        }
      }
      rl.close();
      if (ptt) {
        await ptt.stop();
      }
    } catch (err) {
      console.error(colors.error((err as Error).message));
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function createChatInterface() {
  const readline = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  return readline.createInterface({ input: stdin, output: stdout });
}

async function maybeUpdate(prompt: (question: string) => Promise<boolean>): Promise<boolean> {
  const result = await checkForUpdates(process.cwd());
  if (result.status === "update-available") {
    const behind = result.behind ?? 0;
    const branch = result.branch ?? "origin";
    const countdownResult = await autoUpdateCountdown(behind, branch, 10);
    if (!countdownResult) {
      return false;
    }
    const update = await attemptUpdate(process.cwd(), result.dirty ?? false);
    if (update.success) {
      if (update.forced) {
        console.log(colors.success("Updated to latest (forced reset). Please restart the CLI to use the new version."));
      } else if (result.dirty) {
        console.log(colors.success("Updated to latest (local changes stashed and restored). Restart the CLI."));
      } else {
        console.log(colors.success("Updated to latest. Please restart the CLI to use the new version."));
      }
      return true;
    }
    console.warn(colors.warn(update.message ?? "Update failed."));
    return false;
  }

  if (result.status === "error") {
    console.warn(colors.warn(result.message ?? "Update check failed."));
  }

  return false;
}

async function attemptUpdate(
  repoDir: string,
  dirty: boolean
): Promise<{ success: boolean; forced: boolean; message?: string }> {
  const updater = dirty ? applyUpdateWithStash : applyUpdate;
  let lastMessage: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await updater(repoDir);
    if (result.success) {
      return { success: true, forced: false, message: result.message };
    }
    lastMessage = result.message ?? lastMessage;
  }

  const forced = await applyForceUpdate(repoDir);
  if (forced.success) {
    return { success: true, forced: true };
  }
  return { success: false, forced: true, message: forced.message ?? lastMessage };
}

function parseYesNo(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

function resolveOption<T>(
  command: Command,
  name: string,
  cliValue: T | undefined,
  fallback: T
): T {
  try {
    const source = command.getOptionValueSource(name);
    if (source === "cli") {
      return cliValue as T;
    }
  } catch {
    // ignore
  }
  return fallback;
}

async function autoUpdateCountdown(behind: number, branch: string, seconds: number): Promise<boolean> {
  console.log(
    colors.info(
      `Update available (${behind} commit${behind === 1 ? "" : "s"} behind ${branch}). Auto-updating in ${seconds} seconds.`
    )
  );
  console.log(colors.warn("Press N to cancel update."));

  const readline = await import("node:readline");
  const { stdin, stdout } = await import("node:process");
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let cancelled = false;
  const cancelPromise = new Promise<void>((resolve) => {
    const onLine = (line: string) => {
      cancelled = line.trim().toLowerCase() === "n";
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      rl.removeListener("line", onLine);
      rl.removeListener("close", onClose);
    };
    rl.on("line", onLine);
    rl.on("close", onClose);
  });

  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    process.stdout.write(colors.info(`Auto-update in ${remaining}...\r`));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (cancelled) {
      break;
    }
  }

  rl.close();
  await cancelPromise;
  process.stdout.write(" \r");
  return !cancelled;
}

function printStats(stats: ConversationStats): void {
  const snapshot = stats.snapshot();
  const parts = [
    `in~${snapshot.inputTokens}`,
    `out~${snapshot.outputTokens}`,
    `total~${snapshot.totalTokens}`,
    `out/s~${snapshot.outputTokensPerSecond.toFixed(1)}`,
    `last/s~${snapshot.lastResponseTokensPerSecond.toFixed(1)}`,
    `elapsed~${snapshot.elapsedSeconds.toFixed(1)}s`
  ];
  console.log(colors.dim(`Stats: ${parts.join(" | ")}`));
}

function attachEscCancel(controller: AbortController, onCancel?: () => void): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return () => undefined;
  }

  const wasRaw = (stdin as { isRaw?: boolean }).isRaw ?? false;
  const onData = (data: Buffer) => {
    if (data.length > 0 && data[0] === 0x1b) {
      if (!controller.signal.aborted) {
        controller.abort();
        onCancel?.();
      }
    }
  };

  try {
    stdin.setRawMode(true);
  } catch {
    return () => undefined;
  }
  stdin.resume();
  stdin.on("data", onData);

  return () => {
    stdin.off("data", onData);
    try {
      stdin.setRawMode(wasRaw);
    } catch {
      // ignore
    }
  };
}

function isAbortError(err: unknown): boolean {
  if (!err) {
    return false;
  }
  const anyErr = err as { name?: string; message?: string };
  if (anyErr.name === "AbortError") {
    return true;
  }
  return typeof anyErr.message === "string" && anyErr.message.toLowerCase().includes("aborted");
}

function makeAgentOutputHandler(spinner: ReturnType<typeof createSpinner>) {
  return (event: { name: string; content: string }) => {
    const wasSpinning = spinner.isSpinning();
    if (wasSpinning) {
      spinner.stop();
    }
    const lowerName = event.name.toLowerCase();
    if (lowerName.includes("research")) {
      const tokens = estimateTokens(event.content);
      const chars = event.content.length;
      const sources = (event.content.match(/https?:\/\/\S+/g) || []).length;
      console.log(
        colors.tool(
          `\n[Research Agent End - tokens~${tokens} | chars=${chars} | sources=${sources}]\n`
        )
      );
    } else {
      const header = colors.tool(`\n[Agent: ${event.name}]`);
      console.log(header);
      console.log(renderMarkdownToAnsi(event.content));
      console.log(colors.dim(`[End Agent: ${event.name}]\n`));
    }
    if (wasSpinning) {
      spinner.start();
    }
  };
}

function printBanner(): void {
  console.log(colors.info(asciiArt));
  console.log(colors.info(formatVersionBanner(versionInfo)));
}

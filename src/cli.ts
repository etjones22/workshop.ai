#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { createAgentSession, runAgent } from "./agent/loop.js";
import { ensureWorkspaceRoot } from "./util/sandboxPath.js";
import { createSpinner } from "./util/spinner.js";
import { applyUpdate, checkForUpdates } from "./util/updater.js";
import { colors } from "./util/colors.js";
import { createPushToTalk } from "./util/speechToText.js";
import { createProgressBar } from "./util/progress.js";
import { ConversationStats } from "./util/stats.js";

const program = new Command();
program
  .name("workshop")
  .description("Workshop.AI local tool-using agent")
  .version("0.1.0");

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
  .command("run")
  .description("Run the Workshop.AI agent once")
  .argument("<request...>", "User request")
  .option("--auto-approve", "Skip confirmations for write tools", false)
  .option("--max-steps <n>", "Max agent steps", (value) => parseInt(value, 10), 12)
  .option("--check-updates", "Check GitHub for updates on startup", true)
  .action(async (requestParts: string[], options: { autoApprove?: boolean; maxSteps?: number }) => {
    try {
      const request = requestParts.join(" ");
      const autoApprove = options.autoApprove ?? false;
      const maxSteps = options.maxSteps ?? 12;
      const checkUpdates = (options as { checkUpdates?: boolean }).checkUpdates ?? true;

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

      const spinner = createSpinner("Thinking...", { frameColor: colors.spinner, textColor: colors.info });
      const stats = new ConversationStats();
      let streamed = false;
      const session = await createAgentSession({
        autoApprove,
        maxSteps,
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
          process.stdout.write(colors.assistant(token));
        }
      });

      spinner.start();
      try {
        stats.addInput(request);
        stats.startResponse();
        const result = await session.runTurn(request);
        spinner.stop();
        if (streamed) {
          process.stdout.write("\n");
        } else {
          stats.addOutputChunk(result);
          console.log(colors.assistant(result));
        }
        stats.finishResponse();
        printStats(stats);
      } catch (err) {
        spinner.stop();
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
  .option("--push-to-talk", "Enable push-to-talk (hold Ctrl+Win)", false)
  .action(async (options: { autoApprove?: boolean; maxSteps?: number; pushToTalk?: boolean }) => {
    try {
      const autoApprove = options.autoApprove ?? false;
      const maxSteps = options.maxSteps ?? 12;
      const checkUpdates = (options as { checkUpdates?: boolean }).checkUpdates ?? true;
      const pushToTalk = options.pushToTalk ?? false;

      const rl = await createChatInterface();
      if (checkUpdates) {
        const updated = await maybeUpdate(async (question) => parseYesNo(await rl.question(colors.prompt(question))));
        if (updated) {
          rl.close();
          return;
        }
      }
      const spinner = createSpinner("Thinking...", { frameColor: colors.spinner, textColor: colors.info });
      const stats = new ConversationStats();
      const streamState = { active: false };
      const session = await createAgentSession({
        autoApprove,
        maxSteps,
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
        onToken: (token: string) => {
          if (!streamState.active) {
            streamState.active = true;
            if (spinner.isSpinning()) {
              spinner.stop();
            }
          }
          stats.addOutputChunk(token);
          process.stdout.write(colors.assistant(token));
        }
      });

      let ptt: ReturnType<typeof createPushToTalk> | null = null;
      let awaitingInput = false;
      if (pushToTalk) {
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
        if (input === "/exit" || input === "/quit") {
          break;
        }
        if (input === "/reset") {
          await session.reset();
          stats.reset();
          console.log(colors.info("Session reset."));
          continue;
        }
        streamState.active = false;
        stats.addInput(input);
        stats.startResponse();
        spinner.start();
        try {
          const response = await session.runTurn(input);
          spinner.stop();
          if (streamState.active) {
            process.stdout.write("\n");
          } else {
            stats.addOutputChunk(response);
            console.log(colors.assistant(response));
          }
          stats.finishResponse();
          printStats(stats);
        } catch (err) {
          spinner.stop();
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
    const question = `Update available (${behind} commit${behind === 1 ? "" : "s"} behind ${branch}). Pull latest now? [y/N] `;
    const approved = await prompt(question);
    if (!approved) {
      return false;
    }
    const update = await applyUpdate(process.cwd());
    if (update.success) {
      console.log(colors.success("Updated to latest. Please restart the CLI to use the new version."));
      return true;
    }
    console.warn(colors.warn(update.message ?? "Update failed."));
    return false;
  }

  if (result.status === "dirty") {
    console.warn(colors.warn("Update skipped: working tree has uncommitted changes."));
    return false;
  }

  if (result.status === "error") {
    console.warn(colors.warn(result.message ?? "Update check failed."));
  }

  return false;
}

function parseYesNo(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
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

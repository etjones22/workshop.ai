#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { createAgentSession, runAgent } from "./agent/loop.js";
import { ensureWorkspaceRoot } from "./util/sandboxPath.js";
import { createSpinner } from "./util/spinner.js";
import { applyUpdate, checkForUpdates } from "./util/updater.js";

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

      const spinner = createSpinner("Thinking...");
      const session = await createAgentSession({
        autoApprove,
        maxSteps,
        confirm: async (question: string) => {
          const wasSpinning = spinner.isSpinning();
          if (wasSpinning) {
            spinner.stop();
          }
          const rl = await createChatInterface();
          const answer = await rl.question(question);
          rl.close();
          if (wasSpinning) {
            spinner.start();
          }
          const normalized = answer.trim().toLowerCase();
          return normalized === "y" || normalized === "yes";
        }
      });

      spinner.start();
      try {
        const result = await session.runTurn(request);
        spinner.stop();
        console.log(result);
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
  .action(async (options: { autoApprove?: boolean; maxSteps?: number }) => {
    try {
      const autoApprove = options.autoApprove ?? false;
      const maxSteps = options.maxSteps ?? 12;
      const checkUpdates = (options as { checkUpdates?: boolean }).checkUpdates ?? true;

      const rl = await createChatInterface();
      if (checkUpdates) {
        const updated = await maybeUpdate(async (question) => parseYesNo(await rl.question(question)));
        if (updated) {
          rl.close();
          return;
        }
      }
      const spinner = createSpinner("Thinking...");
      const session = await createAgentSession({
        autoApprove,
        maxSteps,
        confirm: async (question: string) => {
          const wasSpinning = spinner.isSpinning();
          if (wasSpinning) {
            spinner.stop();
          }
          const answer = await rl.question(question);
          const normalized = answer.trim().toLowerCase();
          if (wasSpinning) {
            spinner.start();
          }
          return normalized === "y" || normalized === "yes";
        }
      });

      console.log("Workshop.AI chat. Type /exit to quit, /reset to clear context.");
      for (;;) {
        const line = await rl.question("> ");
        const input = line.trim();
        if (!input) {
          continue;
        }
        if (input === "/exit" || input === "/quit") {
          break;
        }
        if (input === "/reset") {
          await session.reset();
          console.log("Session reset.");
          continue;
        }
        spinner.start();
        try {
          const response = await session.runTurn(input);
          spinner.stop();
          console.log(response);
        } catch (err) {
          spinner.stop();
          throw err;
        }
      }
      rl.close();
    } catch (err) {
      console.error((err as Error).message);
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
      console.log("Updated to latest. Please restart the CLI to use the new version.");
      return true;
    }
    console.warn(update.message ?? "Update failed.");
    return false;
  }

  if (result.status === "dirty") {
    console.warn("Update skipped: working tree has uncommitted changes.");
    return false;
  }

  if (result.status === "error") {
    console.warn(result.message ?? "Update check failed.");
  }

  return false;
}

function parseYesNo(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

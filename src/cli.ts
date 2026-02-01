#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { runAgent, createAgentSession } from "./agent/loop.js";
import { ensureWorkspaceRoot } from "./util/sandboxPath.js";

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
  .action(async (requestParts: string[], options: { autoApprove?: boolean; maxSteps?: number }) => {
    try {
      const request = requestParts.join(" ");
      const result = await runAgent({
        request,
        autoApprove: options.autoApprove ?? false,
        maxSteps: options.maxSteps ?? 12
      });
      console.log(result);
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
  .action(async (options: { autoApprove?: boolean; maxSteps?: number }) => {
    try {
      const autoApprove = options.autoApprove ?? false;
      const maxSteps = options.maxSteps ?? 12;

      const rl = await createChatInterface();
      const session = await createAgentSession({
        autoApprove,
        maxSteps,
        confirm: async (question: string) => {
          const answer = await rl.question(question);
          const normalized = answer.trim().toLowerCase();
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
        const response = await session.runTurn(input);
        console.log(response);
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

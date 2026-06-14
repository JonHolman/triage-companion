#!/usr/bin/env node

import { Command } from "commander";

import { inlineErrorText } from "./commands/command-utils.ts";
import { DEFAULT_NODE_MAJOR } from "./config.ts";
import { registerCommands } from "./commands/index.ts";
import { MenuInterruptedError, runInteractiveMenu } from "./menu.ts";

const currentNodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(currentNodeMajor) || currentNodeMajor < DEFAULT_NODE_MAJOR) {
  process.stderr.write(
    `triage-companion requires Node.js ${DEFAULT_NODE_MAJOR} or newer. Detected Node ${process.version}.\n`,
  );
  process.exit(1);
}

const program = new Command();
program
  .name("triage-companion")
  .description(
    "Developer productivity hub - GitHub, Snyk, Jira, and Git in one terminal.\n\n" +
      "Each service is enabled by providing its token or credentials.\n" +
      "Run 'triage-companion status' to see which services are configured or available.",
  )
  .version("1.0.0");

async function runMenuCommand(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("triage-companion interactive menu requires a TTY.\n");
    process.exitCode = 1;
    return;
  }

  try {
    await runInteractiveMenu();
  } catch (error) {
    if (error instanceof MenuInterruptedError) {
      process.exitCode = 130;
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`triage-companion menu error: ${inlineErrorText(message)}\n`);
      process.exitCode = 1;
    }
  }
}

registerCommands(program);
program
  .command("menu")
  .description("Open the interactive terminal menu")
  .action(runMenuCommand);
await program.parseAsync(process.argv);

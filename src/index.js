#!/usr/bin/env node

/**
 * triage-companion - Terminal tool for developer productivity.
 *
 * Aggregates GitHub notifications, Snyk security issues, Jira tickets,
 * and local Git repository status into a single command-line interface.
 *
 * Each service activates when its token/credentials are provided.
 * Run `triage-companion status` to see which services are configured or available.
 */

import { Command } from "commander";
import { register as registerGitHub } from "./commands/github.js";
import { register as registerSnyk } from "./commands/snyk.js";
import { register as registerJira } from "./commands/jira.js";
import { register as registerGit } from "./commands/git.js";
import { register as registerStatus } from "./commands/status.js";

const program = new Command();

program
  .name("triage-companion")
  .description(
    "Developer productivity hub - GitHub, Snyk, Jira, and Git in one terminal.\n\n" +
    "Each service is enabled by providing its token or credentials.\n" +
    "Run 'triage-companion status' to see which services are configured or available."
  )
  .version("1.0.0");

registerGitHub(program);
registerSnyk(program);
registerJira(program);
registerGit(program);
registerStatus(program);

await program.parseAsync(process.argv);

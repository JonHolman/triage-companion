import { Command } from "commander";

import * as git from "../clients/git.ts";
import { bold, dim, responsiveTable } from "../format.ts";
import { parseLimit, runCommand } from "./command-utils.ts";

function parseSearchOption(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("--search must not be empty.");
  }

  return normalized;
}

export function register(program: Command): void {
  const cmd = program.command("git").description("Git repository status");

  cmd
    .command("dirty")
    .description("List repositories with uncommitted changes")
    .option("--limit <n>", "Maximum repos to show", "300")
    .option("--search <query>", "Filter results by name/branch/path")
    .option("--json", "Output as JSON", false)
    .action((opts: { limit: string; search?: string; json: boolean }) => {
      return runCommand("git dirty", () => {
        const requestedLimit = parseLimit(opts.limit, "--limit");
        const query = parseSearchOption(opts.search);
        const repos = git.listDirtyRepositories({
          maxResults: Number.MAX_SAFE_INTEGER,
          searchQuery: query,
        });

        const matches = repos.slice(0, requestedLimit);
        const omittedCount = repos.length - matches.length;

        if (opts.json) {
          console.log(JSON.stringify(matches, null, 2));
          return;
        }

        if (matches.length === 0) {
          console.log("No dirty repositories found.");
          return;
        }

        console.log(
          `${bold("Dirty Repositories")} ${dim(`(${matches.length} with uncommitted changes)\n`)}`,
        );

        const rows = matches.map((repository) => {
          const changes: string[] = [];
          if (repository.stagedCount > 0) changes.push(`${repository.stagedCount} staged`);
          if (repository.unstagedCount > 0) changes.push(`${repository.unstagedCount} modified`);
          if (repository.untrackedCount > 0) changes.push(`${repository.untrackedCount} untracked`);
          const changeSummary = changes.join(", ") || `${repository.changedCount} changed`;

          const sync: string[] = [];
          if (repository.aheadCount > 0) sync.push(`↑${repository.aheadCount}`);
          if (repository.behindCount > 0) sync.push(`↓${repository.behindCount}`);

          return [
            repository.path,
            repository.name,
            repository.branch,
            String(repository.changedCount),
            changeSummary,
            sync.join(" ") || dim("–"),
          ];
        });

        console.log(
          responsiveTable(rows, {
            headers: ["Path", "Repo", "Branch", "#", "Changes", "Sync"],
          }),
        );

        if (omittedCount > 0) {
          console.log(dim(`${omittedCount} more dirty repositories matched; raise --limit to show them.`));
        }
      });
    });

  cmd
    .command("status")
    .description("Show full git status for dirty repositories")
    .option("--search <query>", "Filter results by name/branch/path")
    .action((opts: { search?: string }) => {
      return runCommand("git status", () => {
        const query = parseSearchOption(opts.search);
        const repos = git.listDirtyRepositories({
          maxResults: Number.MAX_SAFE_INTEGER,
          searchQuery: query,
        });

        if (repos.length === 0) {
          console.log("No dirty repositories found.");
          return;
        }

        for (const repository of repos) {
          console.log(`${bold(`\n${repository.name}`)} ${dim(`(${repository.branch}) — ${repository.path}`)}`);
          for (const line of repository.statusLines) {
            console.log(`  ${line}`);
          }
        }
      });
    });
}

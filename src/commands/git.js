import * as git from "../clients/git.js";
import { bold, dim, table, truncate } from "../format.js";

export function register(program) {
  const cmd = program.command("git").description("Git repository status");

  // ── dirty ────────────────────────────────────────────────────────
  cmd
    .command("dirty")
    .description("List repositories with uncommitted changes")
    .option("--limit <n>", "Maximum repos to show", "300")
    .option("--search <query>", "Filter results by name/branch/path")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      try {
        let repos = git.listDirtyRepositories({
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.search) {
          const q = opts.search.toLowerCase();
          repos = repos.filter(
            (r) =>
              r.name.toLowerCase().includes(q) ||
              r.branch.toLowerCase().includes(q) ||
              r.path.toLowerCase().includes(q)
          );
        }

        if (opts.json) {
          console.log(JSON.stringify(repos, null, 2));
          return;
        }

        if (repos.length === 0) {
          console.log("No dirty repositories found.");
          return;
        }

        console.log(bold(`Dirty Repositories`) + dim(` (${repos.length} with uncommitted changes)\n`));

        const rows = repos.map((r) => {
          const parts = [];
          if (r.stagedCount > 0) parts.push(`${r.stagedCount} staged`);
          if (r.unstagedCount > 0) parts.push(`${r.unstagedCount} modified`);
          if (r.untrackedCount > 0) parts.push(`${r.untrackedCount} untracked`);
          const changes = parts.join(", ") || `${r.changedCount} changed`;

          const sync = [];
          if (r.aheadCount > 0) sync.push(`↑${r.aheadCount}`);
          if (r.behindCount > 0) sync.push(`↓${r.behindCount}`);

          return [
            truncate(r.name, 28),
            r.branch,
            String(r.changedCount),
            changes,
            sync.join(" ") || dim("–"),
            truncate(r.path, 40),
          ];
        });

        console.log(
          table(rows, {
            headers: ["Repo", "Branch", "#", "Changes", "Sync", "Path"],
          })
        );
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  // ── status (verbose) ─────────────────────────────────────────────
  cmd
    .command("status")
    .description("Show full git status for dirty repositories")
    .option("--search <query>", "Filter results by name")
    .action((opts) => {
      try {
        let repos = git.listDirtyRepositories();

        if (opts.search) {
          const q = opts.search.toLowerCase();
          repos = repos.filter(
            (r) =>
              r.name.toLowerCase().includes(q) ||
              r.path.toLowerCase().includes(q)
          );
        }

        if (repos.length === 0) {
          console.log("No dirty repositories found.");
          return;
        }

        for (const r of repos) {
          console.log(bold(`\n${r.name}`) + dim(` (${r.branch}) — ${r.path}`));
          for (const line of r.statusLines) {
            console.log(`  ${line}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });
}

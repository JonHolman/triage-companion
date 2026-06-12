import * as github from "../clients/github.js";
import { bold, dim, severityColor, table, truncate, relativeTime } from "../format.js";

export function register(program) {
  const cmd = program.command("github").description("GitHub notifications and security alerts");

  // ── token ────────────────────────────────────────────────────────
  cmd
    .command("token")
    .description("Save a GitHub personal access token")
    .argument("<token>", "GitHub personal access token")
    .action((token) => {
      github.saveToken(token);
      console.log("✓ GitHub token saved.");
    });

  // ── notifications ────────────────────────────────────────────────
  cmd
    .command("notifications")
    .description("List GitHub notifications")
    .option("--all", "Include read notifications", false)
    .option("--limit <n>", "Maximum notifications to fetch", "50")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const notifications = await github.listNotifications({
          maxResults: parseInt(opts.limit, 10),
          includeRead: opts.all,
        });

        if (opts.json) {
          console.log(JSON.stringify(notifications, null, 2));
          return;
        }

        if (notifications.length === 0) {
          console.log("No notifications.");
          return;
        }

        const unread = notifications.filter((n) => n.isUnread).length;
        console.log(bold(`GitHub Notifications`) + dim(` (${unread} unread, ${notifications.length} total)\n`));

        const rows = notifications.map((n) => [
          n.isUnread ? "●" : " ",
          truncate(n.repositoryFullName.split("/").pop() ?? n.repositoryFullName, 25),
          n.subjectType === "PullRequest" ? "PR" : n.subjectType === "Issue" ? "Issue" : n.subjectType,
          truncate(n.subjectTitle, 50),
          n.reason,
          relativeTime(n.updatedAt),
          dim(n.id),
        ]);

        console.log(
          table(rows, {
            headers: ["", "Repo", "Type", "Title", "Reason", "Updated", "ID"],
          })
        );

        console.log(dim(`\nMark read: triage-companion github mark-read <id>`));
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  // ── mark-read ────────────────────────────────────────────────────
  cmd
    .command("mark-read")
    .description("Mark a notification as read")
    .argument("<id>", "Notification thread ID")
    .action(async (id) => {
      try {
        await github.markNotificationRead(id);
        console.log(`✓ Notification ${id} marked as read.`);
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  cmd
    .command("my-open-prs")
    .description("List your open pull requests discovered from local GitHub clones")
    .argument("[paths...]", "Repository paths to inspect instead of scanning search roots")
    .option("--search-roots <paths>", "Colon-separated roots to scan for repositories")
    .option("--author-regex <pattern>", "Case-insensitive regex matching your commit author")
    .option("--json", "Output as JSON", false)
    .action((paths, opts) => {
      try {
        const searchRoots = opts.searchRoots
          ? opts.searchRoots.split(":").map((value) => value.trim()).filter(Boolean)
          : [];
        const pullRequests = github.listMyOpenPullRequests({
          repositoryPaths: paths ?? [],
          searchRoots,
          authorRegex: opts.authorRegex ?? process.env.TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX ?? null,
        });

        if (opts.json) {
          console.log(JSON.stringify(pullRequests, null, 2));
          return;
        }

        if (pullRequests.length === 0) {
          console.log("No open pull requests found.");
          return;
        }

        console.log(bold("My Open Pull Requests") + dim(` (${pullRequests.length} found)\n`));

        const rows = pullRequests.map((pr) => [
          truncate(pr.repositoryName, 24),
          truncate(pr.branch, 28),
          `#${pr.pullRequestNumber}`,
          truncate(pr.author, 28),
          truncate(pr.repositoryPath, 42),
        ]);

        console.log(
          table(rows, {
            headers: ["Repo", "Branch", "PR", "Author", "Path"],
          })
        );
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  // ── security-alerts ──────────────────────────────────────────────
  cmd
    .command("security-alerts")
    .description("List Dependabot security alerts from notification repositories")
    .argument("[repos...]", "Repository full names (owner/repo)")
    .option("--json", "Output as JSON", false)
    .action(async (repos, opts) => {
      try {
        if (!repos || repos.length === 0) {
          // auto-discover from notifications
          const notifications = await github.listNotifications({ maxResults: 200 });
          const secRepos = new Set(
            notifications
              .filter(
                (n) =>
                  n.subjectType === "RepositoryDependabotAlertsThread" ||
                  n.reason === "security_alert"
              )
              .map((n) => n.repositoryFullName)
          );
          repos = [...secRepos].sort();
          if (repos.length === 0) {
            console.log("No repositories with security alert notifications.");
            return;
          }
        }

        const alerts = await github.listSecurityAlerts(repos);

        if (opts.json) {
          console.log(JSON.stringify(alerts, null, 2));
          return;
        }

        if (alerts.length === 0) {
          console.log("No open Dependabot alerts.");
          return;
        }

        const counts = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const a of alerts) {
          const key = a.severity?.toLowerCase();
          if (key in counts) counts[key]++;
        }

        console.log(
          bold("Dependabot Security Alerts") +
            dim(
              ` (${alerts.length} total: ` +
                Object.entries(counts)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(", ") +
                ")\n"
            )
        );

        const rows = alerts.map((a) => [
          severityColor(a.severity, a.severity.toUpperCase()),
          truncate(a.repositoryFullName.split("/").pop(), 25),
          truncate(a.packageName, 20),
          truncate(a.summary || a.ghsaID, 45),
          a.patchedVersion ?? dim("none"),
        ]);

        console.log(
          table(rows, {
            headers: ["Severity", "Repo", "Package", "Advisory", "Patched"],
          })
        );
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });
}

import { Command } from "commander";

import * as github from "../clients/github.ts";
import {
  bold,
  dim,
  relativeTime,
  severityColor,
  responsiveTable,
} from "../format.ts";
import { ENV, getServiceDefinition } from "../config-model.ts";
import { summarizeSeverities } from "../severity.ts";
import { parseLimit, parseSearchRootsJSON, printSetupGuidance, printTokenPermissions, runCommand, textEnvOverrideState } from "./command-utils.ts";

const githubService = getServiceDefinition("github");

function rawNonBlankEnvValue(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return value.trim().length === 0 ? null : value;
}

export function register(program: Command): void {
  const cmd = program
    .command("github")
    .description("GitHub notifications, workflow failures, and security alerts");

  cmd
    .command("token")
    .description("Save a GitHub personal access token")
    .argument("<token>", "GitHub personal access token")
    .action((token: string) => {
      return runCommand("github token", () => {
        github.saveToken(token);
        console.log("✓ GitHub token saved.");
        printSetupGuidance(githubService);
        printTokenPermissions(githubService);
      });
    });

  cmd
    .command("remove-token")
    .description("Remove the saved GitHub personal access token")
    .action(() => {
      return runCommand("github remove-token", () => {
        github.removeToken();
        console.log("✓ GitHub token removed.");
        const tokenState = textEnvOverrideState(process.env[ENV.GITHUB_TOKEN]);
        if (tokenState === "invalid") {
          console.log(dim(`${ENV.GITHUB_TOKEN} is still set but invalid, so GitHub commands will fail until it is fixed or unset.`));
        } else if (tokenState === "valid") {
          console.log(dim(`${ENV.GITHUB_TOKEN} still provides the effective GitHub token when set.`));
        }
      });
    });

  cmd
    .command("notifications")
    .description("List GitHub notifications")
    .option("--all", "Include read notifications", false)
    .option("--limit <n>", "Maximum notifications to fetch", "50")
    .option("--json", "Output as JSON", false)
    .action((opts: { all: boolean; limit: string; json: boolean }) => {
      return runCommand("github notifications", async () => {
        const notifications = await github.listNotifications({
          maxResults: parseLimit(opts.limit, "--limit"),
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
        console.log(
          `${bold("GitHub Notifications")} ${dim(`(${unread} unread, ${notifications.length} total)\n`)}`,
        );

        const rows = notifications.map((notification) => [
          notification.webURL,
          notification.isUnread ? "●" : " ",
          notification.subjectType === "PullRequest"
            ? "PR"
            : notification.subjectType === "Issue"
              ? "Issue"
              : notification.subjectType,
          notification.repositoryFullName,
          notification.subjectTitle,
          notification.reason,
          relativeTime(notification.updatedAt),
          notification.id,
        ]);

        console.log(
          responsiveTable(rows, {
            headers: ["Link", "Read", "Type", "Repo", "Title", "Reason", "Updated", "ID"],
          }),
        );
        console.log(dim(`\nMark read: triage-companion github mark-read <id>`));
      });
    });

  cmd
    .command("mark-read")
    .description("Mark a notification as read")
    .argument("<id>", "Notification thread ID")
    .action((id: string) => {
      return runCommand("github mark-read", async () => {
        await github.markNotificationRead(id);
        console.log(`✓ Notification ${id} marked as read.`);
      });
    });

  cmd
    .command("my-open-prs")
    .description("List your open pull requests from local GitHub clones")
    .argument(
      "[paths...]",
      "Repository paths to inspect instead of scanning search roots",
    )
    .option(
      "--search-roots <paths-json>",
      "JSON array of paths overriding repository discovery roots",
    )
    .option(
      "--author-regex <pattern>",
      "Case-insensitive regex matching your commit author",
    )
    .option(
      "--github-login <login>",
      "Override the GitHub login used to match your branch author",
    )
    .option("--json", "Output as JSON", false)
    .action(
      (
        paths: string[] | undefined,
        opts: {
          searchRoots?: string;
          authorRegex?: string;
          githubLogin?: string;
          json: boolean;
        },
      ) => {
        return runCommand("github my-open-prs", async () => {
          const searchRoots = opts.searchRoots === undefined
            ? undefined
            : parseSearchRootsJSON(opts.searchRoots, "--search-roots");
          const pullRequests = await github.listMyOpenPullRequests({
            repositoryPaths: paths && paths.length > 0 ? paths : undefined,
            searchRoots,
            authorRegex: opts.authorRegex ?? rawNonBlankEnvValue(process.env[ENV.GITHUB_PR_AUTHOR_REGEX]),
            githubLogin: opts.githubLogin ?? null,
          });

          if (opts.json) {
            console.log(JSON.stringify(pullRequests, null, 2));
            return;
          }

          if (pullRequests.length === 0) {
            console.log("No open pull requests found.");
            return;
          }

          console.log(
            `${bold("My Open Pull Requests")} ${dim(`(${pullRequests.length} found)\n`)}`,
          );

          const rows = pullRequests.map((pr) => [
            pr.url,
            pr.repositoryName,
            pr.branch,
            `#${pr.pullRequestNumber}`,
            pr.author,
            pr.repositoryPath,
          ]);

          console.log(
            responsiveTable(rows, {
              headers: ["Link", "Repo", "Branch", "PR", "Author", "Path"],
            }),
          );
        });
      },
    );

  cmd
    .command("security-alerts")
    .description("List Dependabot security alerts from notification repositories")
    .argument("[repos...]", "Repository full names (owner/repo)")
    .option("--json", "Output as JSON", false)
    .action((repos: string[] | undefined, opts: { json: boolean }) => {
      return runCommand("github security-alerts", async () => {
        let targetRepos = repos ?? [];
        if (targetRepos.length === 0) {
          targetRepos = await github.listSecurityAlertNotificationRepositories();
          if (targetRepos.length === 0) {
            if (opts.json) {
              console.log("[]");
            } else {
              console.log("No repositories with security alert notifications.");
            }
            return;
          }
        }

        const alerts = await github.listSecurityAlerts(targetRepos);
        if (opts.json) {
          console.log(JSON.stringify(alerts, null, 2));
          return;
        }

        if (alerts.length === 0) {
          console.log("No open Dependabot alerts.");
          return;
        }

        const summary = summarizeSeverities(alerts.map((alert) => alert.severity));
        const summaryText = summary ? `${alerts.length} total: ${summary}` : `${alerts.length} total`;

        console.log(
          `${bold("Dependabot Security Alerts")} ${dim(`(${summaryText})\n`)}`,
        );

        const rows = alerts.map((alert) => [
          alert.url,
          severityColor(alert.severity, alert.severity.toUpperCase()),
          alert.repositoryFullName,
          alert.packageName,
          alert.summary,
          alert.patchedVersion ?? "none",
        ]);

        console.log(
          responsiveTable(rows, {
            headers: ["Link", "Severity", "Repo", "Package", "Advisory", "Patched"],
          }),
        );
      });
    });

  cmd
    .command("failed-workflows")
    .description("List recent failed GitHub Actions workflow runs")
    .argument("[repos...]", "Repository full names (owner/repo); defaults to the current GitHub clone")
    .option("--limit <n>", "Maximum failed runs to fetch per repository", "5")
    .option("--json", "Output as JSON", false)
    .action((repos: string[] | undefined, opts: { limit: string; json: boolean }) => {
      return runCommand("github failed-workflows", async () => {
        const maxPerRepo = parseLimit(opts.limit, "--limit");
        let targetRepos = repos ?? [];
        if (targetRepos.length === 0) {
          const currentRepo = github.resolveCurrentRepositoryFullName();
          if (!currentRepo) {
            throw new Error(
              "Could not infer a GitHub repository from the current directory. Pass owner/repo explicitly.",
            );
          }
          targetRepos = [currentRepo];
        }

        const runs = await github.listFailedWorkflowRuns(targetRepos, {
          maxPerRepo,
        });

        if (opts.json) {
          console.log(JSON.stringify(runs, null, 2));
          return;
        }

        if (runs.length === 0) {
          console.log("No recent failed GitHub Actions workflow runs.");
          return;
        }

        console.log(
          `${bold("Failed GitHub Actions Workflows")} ${dim(`(${runs.length} recent failures)\n`)}`,
        );

        const rows = runs.map((run) => [
          run.url,
          run.repositoryFullName,
          run.workflowName,
          run.title,
          run.branch ?? "–",
          run.conclusion,
          relativeTime(run.updatedAt),
        ]);

        console.log(
          responsiveTable(rows, {
            headers: ["Link", "Repo", "Workflow", "Title", "Branch", "Conclusion", "Updated"],
          }),
        );
      });
    });
}

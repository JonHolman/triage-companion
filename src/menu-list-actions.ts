import * as github from "./clients/github.ts";
import * as jira from "./clients/jira.ts";
import * as snyk from "./clients/snyk.ts";
import type {
  DependabotAlert,
  FailedWorkflowRun,
  GitHubNotification,
  OpenPullRequest,
  OpenPullRequestOptions,
} from "./clients/github-types.ts";
import type { SnykIssue } from "./clients/snyk-types.ts";
import { ENV } from "./config-model.ts";
import { startActivityNotice } from "./commands/command-utils.ts";
import { relativeTime, severityColor } from "./format.ts";
import { browseMenuList, type MenuListItem } from "./menu-list.ts";
import { prompt, promptWithCancel } from "./menu-prompts.ts";

interface MenuListActionClients {
  github: Pick<
    typeof github,
    | "listFailedWorkflowRuns"
    | "listMyOpenPullRequests"
    | "listNotifications"
    | "listSecurityAlertNotificationRepositories"
    | "listSecurityAlerts"
    | "markNotificationRead"
    | "mergePullRequestFromWebURL"
    | "resolveCurrentRepositoryFullName"
  >;
  jira: Pick<typeof jira, "listOpenTickets">;
  snyk: Pick<typeof snyk, "listOpenIssues">;
}

interface MenuListActionClientOverrides {
  github?: Partial<MenuListActionClients["github"]>;
  jira?: Partial<MenuListActionClients["jira"]>;
  snyk?: Partial<MenuListActionClients["snyk"]>;
}

const defaultMenuListActionClients: MenuListActionClients = { github, jira, snyk };
let menuListActionClients = defaultMenuListActionClients;

export function setMenuListActionClientsForTest(
  overrides: MenuListActionClientOverrides,
): () => void {
  const previous = menuListActionClients;
  menuListActionClients = {
    github: { ...previous.github, ...overrides.github },
    jira: { ...previous.jira, ...overrides.jira },
    snyk: { ...previous.snyk, ...overrides.snyk },
  };

  return () => {
    menuListActionClients = previous;
  };
}

async function withActivity<T>(
  label: string,
  action: () => Promise<T>,
  { immediate = false }: { immediate?: boolean } = {},
): Promise<T> {
  const notice = startActivityNotice(label, { immediate });
  try {
    return await action();
  } finally {
    notice?.stop();
  }
}

function rawNonBlankEnvValue(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return value.trim().length === 0 ? null : value;
}

function notificationType(type: string): string {
  if (type === "PullRequest") {
    return "PR";
  }
  if (type === "Issue") {
    return "Issue";
  }
  return type;
}

function notificationItem(notification: GitHubNotification): MenuListItem {
  const fields: Array<readonly [string, string]> = [
    ["ID", notification.id],
    ["Repository", notification.repositoryFullName],
    ["Type", notificationType(notification.subjectType)],
    ["Reason", notification.reason],
    ["Updated", relativeTime(notification.updatedAt)],
    ["Link", notification.webURL],
  ];
  if (notification.subjectState !== null) {
    fields.splice(4, 0, ["State", notification.subjectState]);
  }
  if (notification.subjectAuthorLogin !== null) {
    fields.splice(4, 0, ["Author", notification.subjectAuthorLogin]);
  }

  return {
    id: notification.id,
    title: notification.subjectTitle,
    subtitle: `${notification.repositoryFullName} ${relativeTime(notification.updatedAt)}`,
    fields,
  };
}

function menuItemField(item: MenuListItem, label: string): string | null {
  return item.fields.find(([fieldLabel]) => fieldLabel === label)?.[1] ?? null;
}

export async function listGitHubNotifications(): Promise<void> {
  const notifications = await withActivity(
    "github notifications",
    () => menuListActionClients.github.listNotifications({ maxResults: 50 }),
  );
  if (notifications.length === 0) {
    console.log("No notifications.");
    return;
  }

  await browseMenuList(
    "GitHub Notifications",
    notifications.map(notificationItem),
    {
      actions: [
        {
          key: "m",
          label: "mark read",
          run: async (item) => {
            const id = item.id;
            if (!id) {
              throw new Error("Selected notification is missing an ID.");
            }
            await withActivity(
              `github mark-read ${id}`,
              () => menuListActionClients.github.markNotificationRead(id),
            );
            return { remove: true, message: `Notification ${id} marked read.` };
          },
        },
        {
          key: "d",
          label: "dismiss",
          run: async (item) => {
            const id = item.id;
            if (!id) {
              throw new Error("Selected notification is missing an ID.");
            }
            await withActivity(
              `github mark-read ${id}`,
              () => menuListActionClients.github.markNotificationRead(id),
            );
            return { remove: true, message: `Notification ${id} dismissed.` };
          },
        },
        {
          key: "y",
          label: "merge PR",
          run: async (item) => {
            if (menuItemField(item, "Type") !== "PR") {
              return { message: "Selected notification is not a pull request." };
            }
            const state = menuItemField(item, "State");
            if (state !== null && state !== "open") {
              return { message: "Selected pull request is not open." };
            }
            const link = menuItemField(item, "Link");
            if (link === null) {
              throw new Error("Selected notification is missing a link.");
            }
            const confirmation = await prompt("Type yes to merge selected pull request (blank, Esc, or q to cancel): ");
            if (confirmation !== "yes") {
              return { message: "Merge canceled." };
            }

            const result = await withActivity(
              `github merge-pr ${item.id ?? ""}`.trim(),
              () => menuListActionClients.github.mergePullRequestFromWebURL(link),
            );
            return {
              remove: true,
              message: `Pull request #${result.pullRequestNumber} merged in ${result.repositoryFullName}.`,
            };
          },
        },
      ],
    },
  );
}

function openPullRequestItem(pr: OpenPullRequest): MenuListItem {
  return {
    title: `${pr.repositoryName} #${pr.pullRequestNumber}`,
    subtitle: pr.branch,
    fields: [
      ["Repository", pr.repositoryName],
      ["Branch", pr.branch],
      ["Author", pr.author],
      ["Path", pr.repositoryPath],
      ["Link", pr.url],
    ],
  };
}

async function browseGitHubOpenPullRequests(options: OpenPullRequestOptions): Promise<void> {
  const skippedRepositories: string[] = [];
  const pullRequests = await withActivity(
    "github my-open-prs",
    () => menuListActionClients.github.listMyOpenPullRequests(
      {
        ...options,
        onSkippedRepository: (repository) => {
          skippedRepositories.push(`${repository.repositoryFullName} at ${repository.repositoryPath}: ${repository.reason}`);
        },
      },
    ),
    { immediate: true },
  );
  for (const repository of skippedRepositories) {
    process.stderr.write(`Skipped GitHub repository ${repository}\n`);
  }
  if (pullRequests.length === 0) {
    console.log("No open pull requests found.");
    return;
  }

  await browseMenuList("My Open Pull Requests", pullRequests.map(openPullRequestItem));
}

export async function listGitHubOpenPullRequests(): Promise<void> {
  await browseGitHubOpenPullRequests({
    authorRegex: rawNonBlankEnvValue(process.env[ENV.GITHUB_PR_AUTHOR_REGEX]),
  });
}

export async function listGitHubOpenPullRequestsWithLogin(): Promise<void> {
  const login = await prompt("GitHub login override (blank to cancel): ");
  if (!login.trim()) {
    return;
  }

  await browseGitHubOpenPullRequests({ githubLogin: login });
}

export async function listGitHubOpenPullRequestsWithAuthorRegex(): Promise<void> {
  const pattern = await prompt("Author regex override (blank to cancel): ");
  if (!pattern.trim()) {
    return;
  }

  await browseGitHubOpenPullRequests({ authorRegex: pattern });
}

function securityAlertItem(alert: DependabotAlert): MenuListItem {
  return {
    title: alert.summary,
    subtitle: `${alert.repositoryFullName} ${alert.severity.toUpperCase()}`,
    fields: [
      ["Severity", severityColor(alert.severity, alert.severity.toUpperCase())],
      ["Repository", alert.repositoryFullName],
      ["Package", alert.packageName],
      ["Range", alert.vulnerableRange ?? "none"],
      ["Patched", alert.patchedVersion ?? "none"],
      ["Manifest", alert.manifestPath ?? "none"],
      ["Link", alert.url],
    ],
  };
}

export async function listGitHubSecurityAlerts(): Promise<void> {
  const repos = await promptWithCancel(
    "Repository full names (owner/repo, space-separated; blank for notification repos): ",
  );
  if (repos === null) {
    return;
  }
  let targetRepos = repos.split(/\s+/).filter(Boolean);
  if (targetRepos.length === 0) {
    targetRepos = await withActivity(
      "github security-alerts",
      () => menuListActionClients.github.listSecurityAlertNotificationRepositories(),
    );
    if (targetRepos.length === 0) {
      console.log("No repositories with security alert notifications.");
      return;
    }
  }

  const alerts = await withActivity(
    "github security-alerts",
    () => menuListActionClients.github.listSecurityAlerts(targetRepos),
  );
  if (alerts.length === 0) {
    console.log("No open Dependabot alerts.");
    return;
  }

  await browseMenuList("Dependabot Security Alerts", alerts.map(securityAlertItem));
}

function failedWorkflowItem(run: FailedWorkflowRun): MenuListItem {
  return {
    title: run.title,
    subtitle: `${run.repositoryFullName} ${relativeTime(run.updatedAt)}`,
    fields: [
      ["Repository", run.repositoryFullName],
      ["Workflow", run.workflowName],
      ["Branch", run.branch ?? "none"],
      ["Conclusion", run.conclusion],
      ["Created", run.createdAt ? relativeTime(run.createdAt) : "unknown"],
      ["Updated", relativeTime(run.updatedAt)],
      ["Link", run.url],
    ],
  };
}

export async function listGitHubFailedWorkflows(): Promise<void> {
  const repos = await promptWithCancel("Repository full names (owner/repo, space-separated; blank for current repo): ");
  if (repos === null) {
    return;
  }
  let targetRepos = repos.split(/\s+/).filter(Boolean);
  if (targetRepos.length === 0) {
    const currentRepo = menuListActionClients.github.resolveCurrentRepositoryFullName();
    if (!currentRepo) {
      throw new Error("Could not infer a GitHub repository from the current directory. Pass owner/repo explicitly.");
    }
    targetRepos = [currentRepo];
  }

  const runs = await withActivity(
    "github failed-workflows",
    () => menuListActionClients.github.listFailedWorkflowRuns(targetRepos, { maxPerRepo: 5 }),
  );
  if (runs.length === 0) {
    console.log("No recent failed GitHub Actions workflow runs.");
    return;
  }

  await browseMenuList("Failed GitHub Actions Workflows", runs.map(failedWorkflowItem));
}

function snykIssueItem(issue: SnykIssue): MenuListItem {
  return {
    title: issue.title,
    subtitle: `${issue.projectName} ${issue.severity.toUpperCase()}`,
    fields: [
      ["Severity", severityColor(issue.severity, issue.severity.toUpperCase())],
      ["Organization", issue.organizationName],
      ["Project", issue.projectName],
      ["Package", issue.packageName ?? "none"],
      ["Type", issue.issueType],
      ["Introduced", relativeTime(issue.introducedAt)],
      ["Updated", relativeTime(issue.updatedAt)],
      ["Link", issue.url],
    ],
  };
}

export async function listSnykIssues(): Promise<void> {
  const snapshot = await withActivity(
    "snyk issues",
    () => menuListActionClients.snyk.listOpenIssues(),
  );
  if (snapshot.issues.length === 0) {
    console.log("No open Snyk issues.");
    return;
  }

  await browseMenuList("Snyk Issues", snapshot.issues.map(snykIssueItem));
}

export async function listSnykIssuesBySeverity(): Promise<void> {
  const severity = await prompt("Severity (critical, high, medium, low): ");
  if (!severity) {
    return;
  }

  const snapshot = await withActivity(
    "snyk issues",
    () => menuListActionClients.snyk.listOpenIssues({ severity }),
  );
  if (snapshot.issues.length === 0) {
    console.log("No open Snyk issues.");
    return;
  }

  await browseMenuList("Snyk Issues", snapshot.issues.map(snykIssueItem));
}

type JiraTicket = Awaited<ReturnType<typeof jira.listOpenTickets>>[number];

function jiraTicketItem(ticket: JiraTicket): MenuListItem {
  return {
    title: `${ticket.key}: ${ticket.summary}`,
    subtitle: `${ticket.status} ${ticket.updatedText}`,
    fields: [
      ["Key", ticket.key],
      ["Type", ticket.issueType],
      ["Status", ticket.status],
      ["Priority", ticket.priority ?? "none"],
      ["Reporter", ticket.reporter ?? "none"],
      ["Updated", ticket.updatedText],
      ["Link", ticket.url],
    ],
  };
}

export async function listJiraTickets(): Promise<void> {
  const tickets = await withActivity(
    "jira tickets",
    () => menuListActionClients.jira.listOpenTickets(),
  );
  if (tickets.length === 0) {
    console.log("No open Jira tickets.");
    return;
  }

  await browseMenuList("Jira Tickets", tickets.map(jiraTicketItem));
}

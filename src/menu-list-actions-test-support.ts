import assert from "node:assert/strict";
import readline from "node:readline";

import * as jira from "./clients/jira.ts";
import type {
  DependabotAlert,
  FailedWorkflowRun,
  GitHubNotification,
  OpenPullRequest,
} from "./clients/github-types.ts";
import type { SnykIssue, SnykIssueSnapshot } from "./clients/snyk-types.ts";
import { resetCache } from "./credential-store.ts";
import { buildMenuTree } from "./menu.ts";
import { setMenuListActionClientsForTest } from "./menu-list-actions.ts";
import type { MenuAction } from "./menu-types.ts";

export type JiraTicket = Awaited<ReturnType<typeof jira.listOpenTickets>>[number];
export type MenuListActionClientOverrides = Parameters<typeof setMenuListActionClientsForTest>[0];

export const originalCreateInterface = readline.createInterface;

function withConfiguredServiceMenu<T>(serviceLabel: string, action: () => T): T {
  const originalEnv = {
    githubToken: process.env.GITHUB_TOKEN,
    snykToken: process.env.SNYK_TOKEN,
    jiraBaseURL: process.env.JIRA_BASE_URL,
    jiraEmail: process.env.JIRA_EMAIL,
    jiraToken: process.env.JIRA_API_TOKEN,
  };

  if (serviceLabel === "GitHub") {
    process.env.GITHUB_TOKEN = "test-github-token";
  }
  if (serviceLabel === "Snyk") {
    process.env.SNYK_TOKEN = "test-snyk-token";
  }
  if (serviceLabel === "Jira") {
    process.env.JIRA_BASE_URL = "https://example.atlassian.net";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "test-jira-token";
  }
  resetCache();

  try {
    return action();
  } finally {
    if (originalEnv.githubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalEnv.githubToken;
    }
    if (originalEnv.snykToken === undefined) {
      delete process.env.SNYK_TOKEN;
    } else {
      process.env.SNYK_TOKEN = originalEnv.snykToken;
    }
    if (originalEnv.jiraBaseURL === undefined) {
      delete process.env.JIRA_BASE_URL;
    } else {
      process.env.JIRA_BASE_URL = originalEnv.jiraBaseURL;
    }
    if (originalEnv.jiraEmail === undefined) {
      delete process.env.JIRA_EMAIL;
    } else {
      process.env.JIRA_EMAIL = originalEnv.jiraEmail;
    }
    if (originalEnv.jiraToken === undefined) {
      delete process.env.JIRA_API_TOKEN;
    } else {
      process.env.JIRA_API_TOKEN = originalEnv.jiraToken;
    }
    resetCache();
  }
}

export function serviceMenuAction(serviceLabel: string, actionLabel: string): MenuAction {
  return withConfiguredServiceMenu(serviceLabel, () => {
    const serviceMenu = buildMenuTree().items.find((item) => item.label === serviceLabel)?.submenu;
    const action = serviceMenu?.items.find((item) => item.label === actionLabel)?.action;
    assert.ok(action);
    return action;
  });
}

export async function withMenuListActionClients(
  overrides: MenuListActionClientOverrides,
  action: () => Promise<void>,
): Promise<void> {
  const restore = setMenuListActionClientsForTest(overrides);
  try {
    await action();
  } finally {
    restore();
  }
}

function emitStdin(data: string): void {
  process.stdin.emit("data", Buffer.from(data));
}

export function mockReadlineAnswer(answer: string): void {
  readline.createInterface = ((() => ({
    question: (_prompt: string, callback: (value: string) => void) => callback(answer),
    close: () => undefined,
    once: () => undefined,
  })) as unknown) as typeof readline.createInterface;
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export async function captureStdout(action: () => Promise<void> | void): Promise<string> {
  const originalStdoutWrite = process.stdout.write;
  let output = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    await action();
    return stripAnsi(output);
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
}

export async function runBrowseMenuListAction(
  action: () => Promise<void> | void,
  keys: readonly string[],
): Promise<string> {
  return captureStdout(async () => {
    let thrown: unknown;
    const pending = Promise.resolve()
      .then(() => action())
      .catch((error: unknown) => {
        thrown = error;
      });
    await flush();
    for (const key of keys) {
      emitStdin(key);
      await flush();
    }
    await pending;
    if (thrown) {
      throw thrown;
    }
  });
}

export function githubNotification(overrides: Partial<GitHubNotification> = {}): GitHubNotification {
  return {
    id: "notification-1",
    repositoryFullName: "octocat/hello-world",
    repositoryURL: "https://github.com/octocat/hello-world",
    subjectTitle: "Review requested",
    subjectType: "PullRequest",
    subjectState: "open",
    subjectMerged: false,
    subjectAuthorLogin: "octocat",
    reason: "review_requested",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    isUnread: true,
    webURL: "https://github.com/octocat/hello-world/pull/1",
    ...overrides,
  };
}

export function dependabotAlert(): DependabotAlert {
  return {
    repositoryFullName: "octocat/hello-world",
    ghsaID: "GHSA-example",
    packageName: "example-package",
    severity: "high",
    state: "open",
    vulnerableRange: "< 1.0.0",
    patchedVersion: "1.0.0",
    manifestPath: "package-lock.json",
    url: "https://github.com/octocat/hello-world/security/dependabot/1",
    summary: "example-package vulnerable to prototype pollution",
  };
}

export function failedWorkflowRun(): FailedWorkflowRun {
  return {
    repositoryFullName: "octocat/current",
    workflowName: "CI",
    title: "CI failed",
    branch: "feature",
    status: "completed",
    conclusion: "failure",
    url: "https://github.com/octocat/current/actions/runs/1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
  };
}

export function openPullRequest(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    repositoryPath: "/repos/octocat/hello-world",
    repositoryName: "hello-world",
    branch: "feature/test",
    pullRequestNumber: 42,
    url: "https://github.com/octocat/hello-world/pull/42",
    author: "octocat",
    headSHA: "abc123",
    ...overrides,
  };
}

export function snykIssue(): SnykIssue {
  return {
    id: "issue-1",
    url: "https://app.snyk.io/org/example/project/project-1#issue-1",
    title: "Prototype pollution",
    severity: "high",
    status: "open",
    issueType: "vulnerability",
    organizationID: "org-1",
    organizationSlug: "example",
    organizationName: "Example Org",
    projectID: "project-1",
    projectName: "Example Project",
    issueKey: "SNYK-JS-EXAMPLE-1",
    packageName: "example-package",
    introducedAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
  };
}

export function snykSnapshot(issues: SnykIssue[]): SnykIssueSnapshot {
  return {
    issues,
    organizationCount: 1,
    projectCount: 1,
    checkedAt: new Date("2026-01-03T00:00:00Z"),
  };
}

export function jiraTicket(): JiraTicket {
  return {
    key: "TC-123",
    issueType: "Task",
    status: "In Progress",
    priority: "High",
    reporter: "dev@example.com",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    updatedText: "today",
    summary: "Exercise menu list actions",
    url: "https://example.atlassian.net/browse/TC-123",
  };
}

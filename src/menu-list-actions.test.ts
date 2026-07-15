import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import readline from "node:readline";

import * as jira from "./clients/jira.ts";
import type {
  DependabotAlert,
  FailedWorkflowRun,
  GitHubNotification,
  OpenPullRequest,
} from "./clients/github-types.ts";
import type { SnykIssue, SnykIssueSnapshot } from "./clients/snyk-types.ts";
import { buildMenuTree } from "./menu.ts";
import { ESCAPE } from "./menu-keys.ts";
import { setMenuListActionClientsForTest } from "./menu-list-actions.ts";
import type { MenuAction } from "./menu-types.ts";

type JiraTicket = Awaited<ReturnType<typeof jira.listOpenTickets>>[number];
type MenuListActionClientOverrides = Parameters<typeof setMenuListActionClientsForTest>[0];
const originalCreateInterface = readline.createInterface;

function serviceMenuAction(serviceLabel: string, actionLabel: string): MenuAction {
  const serviceMenu = buildMenuTree().items.find((item) => item.label === serviceLabel)?.submenu;
  const action = serviceMenu?.items.find((item) => item.label === actionLabel)?.action;
  assert.ok(action);
  return action;
}

async function withMenuListActionClients(
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

function mockReadlineAnswer(answer: string): void {
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

async function captureStdout(action: () => Promise<void> | void): Promise<string> {
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

async function runBrowseMenuListAction(
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

function githubNotification(overrides: Partial<GitHubNotification> = {}): GitHubNotification {
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

function dependabotAlert(): DependabotAlert {
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

function failedWorkflowRun(): FailedWorkflowRun {
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

function openPullRequest(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
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

function snykIssue(): SnykIssue {
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

function snykSnapshot(issues: SnykIssue[]): SnykIssueSnapshot {
  return {
    issues,
    organizationCount: 1,
    projectCount: 1,
    checkedAt: new Date("2026-01-03T00:00:00Z"),
  };
}

function jiraTicket(): JiraTicket {
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

describe("menu list actions", { concurrency: false }, () => {
  afterEach(() => {
    readline.createInterface = originalCreateInterface;
    process.stdin.removeAllListeners("data");
    process.stdin.pause();
  });

  test("menu-wired listGitHubNotifications renders stubbed data through browseMenuList", async () => {
    await withMenuListActionClients(
      {
        github: {
          listNotifications: async () => [githubNotification()],
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("GitHub", "List notifications"),
          ["q"],
        );

        assert.match(output, /GitHub Notifications/);
        assert.match(output, /Review requested/);
        assert.match(output, /Repository: octocat\/hello-world/);
        assert.match(output, /m mark read, d dismiss/);
      },
    );
  });

  test("menu-wired listSnykIssues renders stubbed data through browseMenuList", async () => {
    await withMenuListActionClients(
      {
        snyk: {
          listOpenIssues: async () => snykSnapshot([snykIssue()]),
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("Snyk", "List issues"),
          ["q"],
        );

        assert.match(output, /Snyk Issues/);
        assert.match(output, /Prototype pollution/);
        assert.match(output, /Project: Example Project/);
      },
    );
  });

  test("menu-wired listJiraTickets renders stubbed data through browseMenuList", async () => {
    await withMenuListActionClients(
      {
        jira: {
          listOpenTickets: async () => [jiraTicket()],
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("Jira", "List tickets"),
          ["q"],
        );

        assert.match(output, /Jira Tickets/);
        assert.match(output, /TC-123: Exercise menu list actions/);
        assert.match(output, /Status: In Progress/);
      },
    );
  });

  test("menu-wired list actions propagate underlying client failures", async () => {
    const cases: Array<{
      service: string;
      actionLabel: string;
      overrides: MenuListActionClientOverrides;
      expected: RegExp;
    }> = [
      {
        service: "GitHub",
        actionLabel: "List notifications",
        overrides: {
          github: {
            listNotifications: async () => {
              throw new Error("github notifications failed");
            },
          },
        },
        expected: /github notifications failed/,
      },
      {
        service: "Snyk",
        actionLabel: "List issues",
        overrides: {
          snyk: {
            listOpenIssues: async () => {
              throw new Error("snyk issues failed");
            },
          },
        },
        expected: /snyk issues failed/,
      },
      {
        service: "Jira",
        actionLabel: "List tickets",
        overrides: {
          jira: {
            listOpenTickets: async () => {
              throw new Error("jira tickets failed");
            },
          },
        },
        expected: /jira tickets failed/,
      },
    ];

    for (const entry of cases) {
      await withMenuListActionClients(entry.overrides, async () => {
        await assert.rejects(
          async () => {
            await serviceMenuAction(entry.service, entry.actionLabel)();
          },
          entry.expected,
        );
      });
    }
  });

  test("menu-wired list actions print empty-result messages", async () => {
    const cases: Array<{
      service: string;
      actionLabel: string;
      overrides: MenuListActionClientOverrides;
      expected: string;
    }> = [
      {
        service: "GitHub",
        actionLabel: "List notifications",
        overrides: { github: { listNotifications: async () => [] } },
        expected: "No notifications.\n",
      },
      {
        service: "Snyk",
        actionLabel: "List issues",
        overrides: { snyk: { listOpenIssues: async () => snykSnapshot([]) } },
        expected: "No open Snyk issues.\n",
      },
      {
        service: "Jira",
        actionLabel: "List tickets",
        overrides: { jira: { listOpenTickets: async () => [] } },
        expected: "No open Jira tickets.\n",
      },
    ];

    for (const entry of cases) {
      await withMenuListActionClients(entry.overrides, async () => {
        const output = await captureStdout(serviceMenuAction(entry.service, entry.actionLabel));
        assert.equal(output, entry.expected);
      });
    }
  });

  test("listGitHubSecurityAlerts uses notification repositories for blank input", async () => {
    mockReadlineAnswer("");
    const alertRepoCalls: string[][] = [];
    let notificationRepoCalls = 0;

    await withMenuListActionClients(
      {
        github: {
          listSecurityAlertNotificationRepositories: async () => {
            notificationRepoCalls += 1;
            return ["octocat/hello-world"];
          },
          listSecurityAlerts: async (repos) => {
            alertRepoCalls.push([...repos]);
            return [dependabotAlert()];
          },
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("GitHub", "List security alerts"),
          ["q"],
        );

        assert.equal(notificationRepoCalls, 1);
        assert.deepEqual(alertRepoCalls, [["octocat/hello-world"]]);
        assert.match(output, /Dependabot Security Alerts/);
        assert.match(output, /example-package vulnerable to prototype pollution/);
      },
    );
  });

  test("listGitHubSecurityAlerts cancels submitted q before default repository lookup", async () => {
    mockReadlineAnswer("q");

    await withMenuListActionClients(
      {
        github: {
          listSecurityAlertNotificationRepositories: async () => {
            throw new Error("default security alert repositories should not be loaded");
          },
          listSecurityAlerts: async () => {
            throw new Error("security alerts should not be loaded");
          },
        },
      },
      async () => {
        const output = await captureStdout(serviceMenuAction("GitHub", "List security alerts"));
        assert.equal(output, "");
      },
    );
  });

  test("listGitHubFailedWorkflows uses current repository for blank input", async () => {
    mockReadlineAnswer("");
    const workflowRepoCalls: string[][] = [];
    let currentRepoCalls = 0;

    await withMenuListActionClients(
      {
        github: {
          resolveCurrentRepositoryFullName: () => {
            currentRepoCalls += 1;
            return "octocat/current";
          },
          listFailedWorkflowRuns: async (repos, options) => {
            workflowRepoCalls.push([...repos]);
            assert.deepEqual(options, { maxPerRepo: 5 });
            return [failedWorkflowRun()];
          },
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("GitHub", "List failed workflows"),
          ["q"],
        );

        assert.equal(currentRepoCalls, 1);
        assert.deepEqual(workflowRepoCalls, [["octocat/current"]]);
        assert.match(output, /Failed GitHub Actions Workflows/);
        assert.match(output, /CI failed/);
      },
    );
  });

  test("listGitHubFailedWorkflows cancels submitted escape before current repository lookup", async () => {
    mockReadlineAnswer(ESCAPE);

    await withMenuListActionClients(
      {
        github: {
          resolveCurrentRepositoryFullName: () => {
            throw new Error("current repository should not be resolved");
          },
          listFailedWorkflowRuns: async () => {
            throw new Error("failed workflow runs should not be loaded");
          },
        },
      },
      async () => {
        const output = await captureStdout(serviceMenuAction("GitHub", "List failed workflows"));
        assert.equal(output, "");
      },
    );
  });

  test("listGitHubNotifications mark-read action marks the selected ID and removes the item", async () => {
    const marked: string[] = [];

    await withMenuListActionClients(
      {
        github: {
          listNotifications: async () => [githubNotification({ id: "thread-123" })],
          markNotificationRead: async (id) => {
            marked.push(id);
          },
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("GitHub", "List notifications"),
          ["m", "q"],
        );

        assert.deepEqual(marked, ["thread-123"]);
        assert.match(output, /Notification thread-123 marked read\./);
        assert.match(output, /\(0 items\)/);
      },
    );
  });

  test("listGitHubNotifications dismiss action marks the selected ID and removes the item", async () => {
    const marked: string[] = [];

    await withMenuListActionClients(
      {
        github: {
          listNotifications: async () => [githubNotification({ id: "thread-456" })],
          markNotificationRead: async (id) => {
            marked.push(id);
          },
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("GitHub", "List notifications"),
          ["d", "q"],
        );

        assert.deepEqual(marked, ["thread-456"]);
        assert.match(output, /Notification thread-456 dismissed\./);
        assert.doesNotMatch(output, /Notification thread-456 marked read\./);
        assert.match(output, /\(0 items\)/);
      },
    );
  });

  test("listGitHubNotifications item actions reject selected items without IDs", async () => {
    for (const key of ["m", "d"]) {
      const marked: string[] = [];
      await withMenuListActionClients(
        {
          github: {
            listNotifications: async () => [githubNotification({ id: "" })],
            markNotificationRead: async (id) => {
              marked.push(id);
            },
          },
        },
        async () => {
          await assert.rejects(
            () => runBrowseMenuListAction(
              serviceMenuAction("GitHub", "List notifications"),
              [key],
            ),
            /Selected notification is missing an ID/,
          );
          assert.deepEqual(marked, []);
        },
      );
    }
  });

  test("menu-wired listGitHubOpenPullRequests renders stubbed data through browseMenuList", async () => {
    const capturedOptions: Parameters<typeof import("./clients/github.ts").listMyOpenPullRequests>[0][] = [];

    await withMenuListActionClients(
      {
        github: {
          listMyOpenPullRequests: async (options) => {
            capturedOptions.push(options);
            return [openPullRequest()];
          },
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("GitHub", "List my open PRs"),
          ["q"],
        );

        assert.equal(capturedOptions.length, 1);
        assert.match(output, /My Open Pull Requests/);
        assert.match(output, /hello-world #42/);
        assert.match(output, /Author: octocat/);
      },
    );
  });

  test("menu-wired listGitHubOpenPullRequestsWithLogin passes login to client and renders results", async () => {
    mockReadlineAnswer("octocat");
    const capturedOptions: Parameters<typeof import("./clients/github.ts").listMyOpenPullRequests>[0][] = [];

    await withMenuListActionClients(
      {
        github: {
          listMyOpenPullRequests: async (options) => {
            capturedOptions.push(options);
            return [openPullRequest()];
          },
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("GitHub", "List my open PRs with login override"),
          ["q"],
        );

        assert.equal(capturedOptions.length, 1);
        assert.equal(capturedOptions[0]?.githubLogin, "octocat");
        assert.match(output, /My Open Pull Requests/);
        assert.match(output, /hello-world #42/);
      },
    );
  });

  test("menu-wired listGitHubOpenPullRequestsWithAuthorRegex passes regex to client and renders results", async () => {
    mockReadlineAnswer("octocat.*");
    const capturedOptions: Parameters<typeof import("./clients/github.ts").listMyOpenPullRequests>[0][] = [];

    await withMenuListActionClients(
      {
        github: {
          listMyOpenPullRequests: async (options) => {
            capturedOptions.push(options);
            return [openPullRequest()];
          },
        },
      },
      async () => {
        const output = await runBrowseMenuListAction(
          serviceMenuAction("GitHub", "List my open PRs with author regex"),
          ["q"],
        );

        assert.equal(capturedOptions.length, 1);
        assert.equal(capturedOptions[0]?.authorRegex, "octocat.*");
        assert.match(output, /My Open Pull Requests/);
        assert.match(output, /hello-world #42/);
      },
    );
  });
});

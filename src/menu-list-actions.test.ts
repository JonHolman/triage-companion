import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import readline from "node:readline";

import { ESCAPE } from "./menu-keys.ts";
import {
  captureStdout,
  dependabotAlert,
  failedWorkflowRun,
  githubNotification,
  jiraTicket,
  mockReadlineAnswer,
  openPullRequest,
  originalCreateInterface,
  runBrowseMenuListAction,
  serviceMenuAction,
  snykIssue,
  snykSnapshot,
  withMenuListActionClients,
  type MenuListActionClientOverrides,
} from "./menu-list-actions-test-support.ts";

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

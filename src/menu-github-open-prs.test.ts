import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import readline from "node:readline";

import {
  mockReadlineAnswer,
  openPullRequest,
  originalCreateInterface,
  runBrowseMenuListAction,
  serviceMenuAction,
  withMenuListActionClients,
} from "./menu-list-actions-test-support.ts";

describe("menu github open pull request actions", { concurrency: false }, () => {
  afterEach(() => {
    readline.createInterface = originalCreateInterface;
    process.stdin.removeAllListeners("data");
    process.stdin.pause();
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

  test("menu login override treats whitespace-only input as cancel", async () => {
    mockReadlineAnswer("   ");
    let listCalls = 0;

    await withMenuListActionClients(
      {
        github: {
          listMyOpenPullRequests: async () => {
            listCalls += 1;
            return [];
          },
        },
      },
      async () => {
        await serviceMenuAction("GitHub", "List my open PRs with login override")();
      },
    );

    assert.equal(listCalls, 0);
  });

  test("menu author regex override treats whitespace-only input as cancel", async () => {
    mockReadlineAnswer("   ");
    let listCalls = 0;

    await withMenuListActionClients(
      {
        github: {
          listMyOpenPullRequests: async () => {
            listCalls += 1;
            return [];
          },
        },
      },
      async () => {
        await serviceMenuAction("GitHub", "List my open PRs with author regex")();
      },
    );

    assert.equal(listCalls, 0);
  });
});

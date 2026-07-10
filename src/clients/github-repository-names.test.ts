import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listFailedWorkflowRuns, listSecurityAlerts } from "./github.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import { jsonResponse, setupGitHubCredentialsTest } from "./github-credentials-test-support.ts";

describe("github repository names", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  function rejectNetwork(): Response {
    throw new Error("unexpected network request");
  }

  test("rejects malformed repository names before GitHub API calls", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["bad owner/repo"]),
        /GitHub repository must be in owner\/repo form/,
      );
    });
  });

  test("rejects repository names with surrounding whitespace before GitHub API calls", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns([" octocat/hello-world "]),
        /GitHub repository must be in owner\/repo form/,
      );
    });
  });

  test("rejects malformed repository names before requiring a GitHub token for failed workflows", async () => {
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["bad owner/repo"]),
        /GitHub repository must be in owner\/repo form/,
      );
    });
  });

  test("rejects repository names with control characters without echoing them", async () => {
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        async () => {
          try {
            await listFailedWorkflowRuns(["octocat/\thello-world"]);
          } catch (error) {
            assert.ok(error instanceof Error);
            assert.match(error.message, /GitHub repository must be in owner\/repo form/);
            assert.doesNotMatch(error.message, /\t/);
            throw error;
          }
        },
        /GitHub repository must be in owner\/repo form/,
      );
    });
  });

  test("rejects repository names with surrounding whitespace before requiring a GitHub token for security alerts", async () => {
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => listSecurityAlerts([" octocat/hello-world "]),
        /GitHub repository must be in owner\/repo form/,
      );
    });
  });

  test("rejects malformed repository names before requiring a GitHub token for security alerts", async () => {
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => listSecurityAlerts(["bad owner/repo"]),
        /GitHub repository must be in owner\/repo form/,
      );
    });
  });

  test("accepts dotted GitHub repository names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [
        "https://api.github.com/repos/octocat/hello..world/actions/runs?status=failure&per_page=1",
        () => jsonResponse({ workflow_runs: [] }),
      ],
    ]));

    await withMockFetch(routes, async () => {
      assert.deepEqual(
        await listFailedWorkflowRuns(["octocat/hello..world"], { maxPerRepo: 1 }),
        [],
      );
    });
  });
});

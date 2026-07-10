import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listFailedWorkflowRuns } from "./github.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import {
  jsonResponse,
  setupGitHubCredentialsTest,
  workflowRunJson,
  workflowRunsUrl,
} from "./github-credentials-test-support.ts";

describe("github workflow run links", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  async function expectRunRejection(run: Record<string, unknown>, pattern: RegExp): Promise<void> {
    const routes = routeHandler(new Map([
      [workflowRunsUrl(5), () => jsonResponse({ workflow_runs: [run] })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(() => listFailedWorkflowRuns(["octocat/hello-world"]), pattern);
    });
  }

  test("rejects failed workflow links for a different repository", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ html_url: "https://github.com/octocat/other/actions/runs/123" }),
      /must link to octocat\/hello-world/,
    );
  });

  test("rejects failed workflow response entries with invalid run ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({
        display_title: "wrong run link",
        html_url: "https://github.com/octocat/hello-world/actions/runs/456",
      }),
      /must link to workflow run 123/,
    );
  });

  test("rejects failed workflow links that are not workflow run links", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ html_url: "https://github.com/octocat/hello-world" }),
      /must link to a GitHub Actions workflow run/,
    );
  });

  test("rejects failed workflow links with duplicate path separators", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ html_url: "https://github.com/octocat//hello-world/actions/runs/123" }),
      /must include a GitHub owner\/repo path/,
    );
  });

  test("rejects failed workflow links with dot path segments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ html_url: "https://github.com/octocat/%2E/hello-world/actions/runs/123" }),
      /must include a GitHub owner\/repo path/,
    );
  });

  test("rejects failed workflow links with non-positive run IDs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({
        id: 0,
        display_title: "bad id",
        html_url: "https://github.com/octocat/hello-world/actions/runs/0",
      }),
      /must contain workflow run objects with valid top-level fields/,
    );
  });

  test("rejects failed workflow links that include credentials", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ html_url: "https://viewer@github.com/octocat/hello-world/actions/runs/123" }),
      /must not include credentials/,
    );
  });

  test("rejects failed workflow links that include ports", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ html_url: "https://github.com:8443/octocat/hello-world/actions/runs/123" }),
      /must not include a port/,
    );
  });

  test("rejects failed workflow links with query strings", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({
        html_url: "https://github.com/octocat/hello-world/actions/runs/123?check_suite_focus=true",
      }),
      /must not include query strings/,
    );
  });

  test("rejects failed workflow links with fragments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({
        html_url: "https://github.com/octocat/hello-world/actions/runs/123#summary",
      }),
      /must not include fragments/,
    );
  });
});

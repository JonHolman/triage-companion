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

describe("github workflow run validation", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  const invalidFieldsPattern =
    /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/;

  async function expectRunsRejection(body: unknown, pattern: RegExp): Promise<void> {
    const routes = routeHandler(new Map([
      [workflowRunsUrl(5), () => jsonResponse(body)],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(() => listFailedWorkflowRuns(["octocat/hello-world"]), pattern);
    });
  }

  async function expectRunRejection(run: Record<string, unknown>, pattern: RegExp): Promise<void> {
    await expectRunsRejection({ workflow_runs: [run] }, pattern);
  }

  test("rejects failed workflow response entries with invalid top-level fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection({ id: "123", conclusion: "failure" }, invalidFieldsPattern);
  });

  test("rejects failed workflow response entries missing conclusion", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection({
      id: 123,
      status: "completed",
      html_url: "https://github.com/octocat/hello-world/actions/runs/123",
    }, invalidFieldsPattern);
  });

  test("rejects failed workflow response entries missing names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(workflowRunJson({
      name: undefined,
      display_title: "missing name",
      updated_at: undefined,
    }), invalidFieldsPattern);
  });

  test("rejects failed workflow response entries missing statuses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(workflowRunJson({
      display_title: "missing status",
      status: undefined,
      updated_at: undefined,
    }), invalidFieldsPattern);
  });

  test("rejects failed workflow response entries missing run ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(workflowRunJson({
      id: undefined,
      display_title: "missing id",
    }), invalidFieldsPattern);
  });

  test("rejects failed workflow response entries missing workflow URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(workflowRunJson({
      display_title: "missing html_url",
      html_url: undefined,
    }), invalidFieldsPattern);
  });

  test("rejects failed workflow response entries with empty conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(workflowRunJson({
      display_title: "empty conclusion",
      conclusion: "",
      updated_at: undefined,
    }), invalidFieldsPattern);
  });

  test("rejects failed workflow response entries with whitespace-only conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(workflowRunJson({
      display_title: "Fix bug",
      conclusion: "   ",
      html_url: undefined,
      updated_at: undefined,
    }), invalidFieldsPattern);
  });

  test("rejects failed workflow response entries with surrounding whitespace in conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(workflowRunJson({
      display_title: "Fix bug",
      conclusion: " failure ",
      html_url: undefined,
      updated_at: undefined,
    }), invalidFieldsPattern);
  });

  test("rejects failed workflow response entries with invalid updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ display_title: "broken updated_at", updated_at: "not-a-date" }),
      /GitHub workflow run for octocat\/hello-world must include a valid updated_at timestamp/,
    );
  });

  test("rejects failed workflow response entries with non-ISO updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ display_title: "broken updated_at", updated_at: "1" }),
      /GitHub workflow run for octocat\/hello-world must include a valid updated_at timestamp/,
    );
  });

  test("rejects failed workflow response entries missing updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ display_title: "missing updated_at", updated_at: undefined }),
      invalidFieldsPattern,
    );
  });

  test("rejects failed workflow response entries with invalid created_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ display_title: "broken created_at", created_at: "not-a-date" }),
      /GitHub workflow run for octocat\/hello-world must include a valid created_at timestamp/,
    );
  });

  test("rejects failed workflow response entries with impossible created_at calendar dates", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ display_title: "broken created_at", created_at: "2026-02-31T00:00:00Z" }),
      /GitHub workflow run for octocat\/hello-world must include a valid created_at timestamp/,
    );
  });

  test("rejects failed workflow response entries with empty created_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunRejection(
      workflowRunJson({ display_title: "empty created_at", created_at: "" }),
      invalidFieldsPattern,
    );
  });

  test("rejects failed workflow responses missing workflow runs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectRunsRejection(
      { total_count: 0 },
      /GitHub workflow runs response for octocat\/hello-world must include a workflow_runs array/,
    );
  });
});

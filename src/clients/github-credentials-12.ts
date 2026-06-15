import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listFailedWorkflowRuns } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 12", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects failed workflow response entries with invalid top-level fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify({
        workflow_runs: [
          {
            id: "123",
            conclusion: "failure",
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries missing conclusion", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              status: "completed",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries missing names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              display_title: "missing name",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries missing statuses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "missing status",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries missing run ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              name: "CI",
              display_title: "missing id",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries missing workflow URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "missing html_url",
              status: "completed",
              conclusion: "failure",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with empty conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "empty conclusion",
              status: "completed",
              conclusion: "",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with whitespace-only conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "Fix bug",
              status: "completed",
              conclusion: "   ",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with surrounding whitespace in conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "Fix bug",
              status: "completed",
              conclusion: " failure ",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with invalid updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "broken updated_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              updated_at: "not-a-date",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must include a valid updated_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with non-ISO updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "broken updated_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              updated_at: "1",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must include a valid updated_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listFailedWorkflowRuns, listSecurityAlerts } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 13", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects failed workflow response entries missing updated_at timestamps", async () => {
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
              display_title: "missing updated_at",
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


  test("rejects failed workflow response entries with invalid created_at timestamps", async () => {
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
              display_title: "broken created_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              created_at: "not-a-date",
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
        /GitHub workflow run for octocat\/hello-world must include a valid created_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with impossible created_at calendar dates", async () => {
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
              display_title: "broken created_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              created_at: "2026-02-31T00:00:00Z",
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
        /GitHub workflow run for octocat\/hello-world must include a valid created_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with empty created_at timestamps", async () => {
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
              display_title: "empty created_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              created_at: "",
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


  test("rejects failed workflow responses missing workflow runs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify({ total_count: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must include a workflow_runs array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed repository names before GitHub API calls", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["bad owner/repo"]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects repository names with surrounding whitespace before GitHub API calls", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns([" octocat/hello-world "]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed repository names before requiring a GitHub token for failed workflows", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["bad owner/repo"]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects repository names with control characters without echoing them", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
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
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects repository names with surrounding whitespace before requiring a GitHub token for security alerts", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts([" octocat/hello-world "]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("accepts dotted GitHub repository names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello..world/actions/runs?status=failure&per_page=1");
      return new Response(JSON.stringify({ workflow_runs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      assert.deepEqual(
        await listFailedWorkflowRuns(["octocat/hello..world"], { maxPerRepo: 1 }),
        [],
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow links for a different repository", async () => {
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
              display_title: "fix bug",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/other/actions/runs/123",
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
        /must link to octocat\/hello-world/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with invalid run ids", async () => {
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
              display_title: "wrong run link",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/456",
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
        /must link to workflow run 123/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow links that are not workflow run links", async () => {
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
              display_title: "fix bug",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world",
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
        /must link to a GitHub Actions workflow run/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

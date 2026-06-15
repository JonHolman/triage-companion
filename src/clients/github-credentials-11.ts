import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listFailedWorkflowRuns } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 11", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("loads recent failed workflow runs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=2");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "fix bug",
              head_branch: "feature",
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
      const runs = await listFailedWorkflowRuns(["octocat/hello-world", "octocat/hello-world"], { maxPerRepo: 2 });
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.url, "https://github.com/octocat/hello-world/actions/runs/123");
      assert.equal(runs[0]?.conclusion, "failure");
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with non-failure conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 124,
              name: "CI",
              display_title: "success",
              head_branch: "main",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/octocat/hello-world/actions/runs/124",
              updated_at: "2026-01-02T00:00:00Z",
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
        /GitHub workflow run for octocat\/hello-world must have conclusion failure/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow response entries with non-completed statuses", async () => {
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
              display_title: "queued but marked failed",
              status: "queued",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              updated_at: "2025-01-02T00:00:00Z",
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
        /GitHub workflow run for octocat\/hello-world must have status completed/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("returns no failed workflow runs without requiring a token when the repository list is empty", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      assert.deepEqual(await listFailedWorkflowRuns([]), []);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("escapes control characters in failed workflow fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () => {
      throw new Error("Bad\tgateway\nretry");
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /Could not fetch GitHub workflow runs for octocat\/hello-world: Bad\\tgateway, retry/,
          );
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects fractional failed workflow limits before API requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await assert.rejects(
      () => listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 0.5 }),
      /GitHub failed workflow limit must be a positive integer/,
    );
  });


  test("caps failed workflow request page size at GitHub maximum", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=100");
      return new Response(JSON.stringify({ workflow_runs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      assert.deepEqual(
        await listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 250 }),
        [],
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("paginates failed workflow runs when the requested limit exceeds GitHub page size", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    const firstPageRuns = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: "CI",
      display_title: `failure ${index + 1}`,
      status: "completed",
      conclusion: "failure",
      html_url: `https://github.com/octocat/hello-world/actions/runs/${index + 1}`,
      updated_at: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;

      if (url === "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=100") {
        return new Response(JSON.stringify({ workflow_runs: firstPageRuns }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=100&page=2>; rel=\"next\"",
          },
        });
      }

      if (url === "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=100&page=2") {
        return new Response(JSON.stringify({
          workflow_runs: [
            {
              id: 101,
              name: "CI",
              display_title: "failure 101",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/101",
              updated_at: "2026-02-01T00:00:00Z",
            },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`unexpected workflow runs url ${url}`);
    };

    try {
      const runs = await listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 101 });
      assert.equal(runs.length, 101);
      assert.equal(calls, 2);
      assert.ok(runs.some((run) => run.url === "https://github.com/octocat/hello-world/actions/runs/101"));
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects empty non-final failed workflow pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=2");

      return new Response(JSON.stringify({
        workflow_runs: [],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=2&page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 2 }),
        /GitHub workflow runs response for octocat\/hello-world returned an empty page before pagination finished/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow runs when pagination repeats the current URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=2";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);

      return new Response(JSON.stringify({
        workflow_runs: [
          {
            id: 123,
            name: "CI",
            display_title: "loop",
            head_branch: "feature",
            status: "completed",
            conclusion: "failure",
            html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: `<${firstURL}>; rel="next"`,
        },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 2 }),
        /GitHub workflow runs pagination for octocat\/hello-world repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed failed workflow responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify({ workflow_runs: {} }), {
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


  test("rejects invalid JSON failed workflow responses clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must be valid JSON/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow responses that are not objects", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify(null), {
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


  test("rejects failed workflow response entries that are not objects", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify({ workflow_runs: [null] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

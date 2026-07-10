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

describe("github failed workflow runs", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  test("loads recent failed workflow runs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    let calls = 0;
    const routes = routeHandler(new Map([
      [workflowRunsUrl(2), () => jsonResponse({
        workflow_runs: [workflowRunJson({ head_branch: "feature" })],
      })],
    ]));

    await withMockFetch((input) => {
      calls += 1;
      return routes(input);
    }, async () => {
      const runs = await listFailedWorkflowRuns(["octocat/hello-world", "octocat/hello-world"], { maxPerRepo: 2 });
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.url, "https://github.com/octocat/hello-world/actions/runs/123");
      assert.equal(runs[0]?.conclusion, "failure");
      assert.equal(calls, 1);
    });
  });

  test("accepts failed workflow runs with a null head_branch", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [workflowRunsUrl(5), () => jsonResponse({
        workflow_runs: [workflowRunJson({ head_branch: null })],
      })],
    ]));

    await withMockFetch(routes, async () => {
      const runs = await listFailedWorkflowRuns(["octocat/hello-world"]);
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.branch, null);
    });
  });

  test("rejects failed workflow response entries with non-failure conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [workflowRunsUrl(5), () => jsonResponse({
        workflow_runs: [workflowRunJson({
          id: 124,
          display_title: "success",
          head_branch: "main",
          conclusion: "success",
          html_url: "https://github.com/octocat/hello-world/actions/runs/124",
          updated_at: "2026-01-02T00:00:00Z",
        })],
      })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must have conclusion failure/,
      );
    });
  });

  test("rejects failed workflow response entries with non-completed statuses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [workflowRunsUrl(5), () => jsonResponse({
        workflow_runs: [workflowRunJson({
          display_title: "queued but marked failed",
          status: "queued",
          updated_at: "2025-01-02T00:00:00Z",
        })],
      })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must have status completed/,
      );
    });
  });

  test("returns no failed workflow runs without requiring a token when the repository list is empty", async () => {
    await withMockFetch(() => {
      throw new Error("unexpected network request");
    }, async () => {
      assert.deepEqual(await listFailedWorkflowRuns([]), []);
    });
  });

  test("escapes control characters in failed workflow fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => {
      throw new Error("Bad\tgateway\nretry");
    }, async () => {
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
    });
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
    const routes = routeHandler(new Map([
      [workflowRunsUrl(100), () => jsonResponse({ workflow_runs: [] })],
    ]));

    await withMockFetch(routes, async () => {
      assert.deepEqual(
        await listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 250 }),
        [],
      );
    });
  });

  test("paginates failed workflow runs when the requested limit exceeds GitHub page size", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    let calls = 0;
    const secondPageURL = `${workflowRunsUrl(100)}&page=2`;

    const firstPageRuns = Array.from({ length: 100 }, (_, index) => workflowRunJson({
      id: index + 1,
      display_title: `failure ${index + 1}`,
      html_url: `https://github.com/octocat/hello-world/actions/runs/${index + 1}`,
      updated_at: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));

    const routes = routeHandler(new Map([
      [workflowRunsUrl(100), () => jsonResponse({ workflow_runs: firstPageRuns }, {
        headers: { Link: `<${secondPageURL}>; rel="next"` },
      })],
      [secondPageURL, () => jsonResponse({
        workflow_runs: [workflowRunJson({
          id: 101,
          display_title: "failure 101",
          html_url: "https://github.com/octocat/hello-world/actions/runs/101",
          updated_at: "2026-02-01T00:00:00Z",
        })],
      })],
    ]));

    await withMockFetch((input) => {
      calls += 1;
      return routes(input);
    }, async () => {
      const runs = await listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 101 });
      assert.equal(runs.length, 101);
      assert.equal(calls, 2);
      assert.ok(runs.some((run) => run.url === "https://github.com/octocat/hello-world/actions/runs/101"));
    });
  });

  test("rejects empty non-final failed workflow pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [workflowRunsUrl(2), () => jsonResponse({ workflow_runs: [] }, {
        headers: { Link: `<${workflowRunsUrl(2)}&page=2>; rel="next"` },
      })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 2 }),
        /GitHub workflow runs response for octocat\/hello-world returned an empty page before pagination finished/,
      );
    });
  });

  test("rejects failed workflow runs when pagination repeats the current URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const firstURL = workflowRunsUrl(2);
    let calls = 0;

    await withMockFetch((input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);
      return jsonResponse({
        workflow_runs: [workflowRunJson({ display_title: "loop", head_branch: "feature" })],
      }, {
        headers: { Link: `<${firstURL}>; rel="next"` },
      });
    }, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 2 }),
        /GitHub workflow runs pagination for octocat\/hello-world repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    });
  });

  test("rejects malformed failed workflow responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [workflowRunsUrl(5), () => jsonResponse({ workflow_runs: {} })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must include a workflow_runs array/,
      );
    });
  });

  test("rejects invalid JSON failed workflow responses clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [workflowRunsUrl(5), () => new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must be valid JSON/,
      );
    });
  });

  test("rejects failed workflow responses that are not objects", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [workflowRunsUrl(5), () => jsonResponse(null)],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must include a workflow_runs array/,
      );
    });
  });

  test("rejects failed workflow response entries that are not objects", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [workflowRunsUrl(5), () => jsonResponse({ workflow_runs: [null] })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects/,
      );
    });
  });
});

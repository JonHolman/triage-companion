import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listFailedWorkflowRuns, listSecurityAlerts } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 14", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects failed workflow links with duplicate path separators", async () => {
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
              html_url: "https://github.com/octocat//hello-world/actions/runs/123",
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
        /must include a GitHub owner\/repo path/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow links with dot path segments", async () => {
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
              html_url: "https://github.com/octocat/%2E/hello-world/actions/runs/123",
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
        /must include a GitHub owner\/repo path/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow links with non-positive run IDs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 0,
              name: "CI",
              display_title: "bad id",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/0",
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
        /must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow links that include credentials", async () => {
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
              html_url: "https://viewer@github.com/octocat/hello-world/actions/runs/123",
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
        /must not include credentials/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow links that include ports", async () => {
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
              html_url: "https://github.com:8443/octocat/hello-world/actions/runs/123",
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
        /must not include a port/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects failed workflow links with query strings", async () => {
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
              html_url: "https://github.com/octocat/hello-world/actions/runs/123?check_suite_focus=true",
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
        /must not include query strings or fragments/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts missing alert numbers", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing", severity: "high", summary: "Missing number" },
            dependency: { package: { name: "pkg-missing" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/1",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts missing html_url", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 7,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing-url", severity: "high", summary: "Missing URL" },
            dependency: { package: { name: "pkg-missing-url" } },
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });



  test("rejects Dependabot alerts with invalid alert numbers", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 1.5,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-bad-number", severity: "high", summary: "Bad number" },
            dependency: { package: { name: "pkg-bad-number" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/1",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alert links that do not match the alert number", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 7,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-wrong", severity: "high", summary: "Wrong number" },
            dependency: { package: { name: "pkg-wrong" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/8",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must link to Dependabot alert 7/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts missing package names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 7,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing-pkg", severity: "high", summary: "Missing package" },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/7",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 7 for octocat\/hello-world missing package name/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

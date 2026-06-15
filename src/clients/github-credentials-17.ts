import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listSecurityAlerts } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 17", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("loads paginated Dependabot alerts and sorts highest severity first", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    const secondURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100&page=2";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      if (url === firstURL) {
        return new Response(
          JSON.stringify([
            {
              number: 1,
              state: "open",
              security_advisory: { ghsa_id: "GHSA-low", severity: "low", summary: "Low issue" },
              dependency: { package: { name: "pkg-low" } },
              html_url: "https://github.com/octocat/hello-world/security/dependabot/1",
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: `<${secondURL}>; rel="next"`,
            },
          },
        );
      }

      if (url === secondURL) {
        return new Response(
          JSON.stringify([
            {
              number: 2,
              state: "open",
              security_advisory: { ghsa_id: "GHSA-critical", severity: "critical", summary: "Critical issue" },
              dependency: { package: { name: "pkg-critical" } },
              html_url: "https://github.com/octocat/hello-world/security/dependabot/2",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected GitHub route: ${url}`);
    };

    try {
      const alerts = await listSecurityAlerts(["octocat/hello-world", "octocat/hello-world"]);
      assert.equal(alerts.length, 2);
      assert.equal(alerts[0]?.severity, "critical");
      assert.equal(alerts[0]?.url, "https://github.com/octocat/hello-world/security/dependabot/2");
      assert.equal(alerts[1]?.severity, "low");
      assert.equal(calls, 2);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects empty non-final Dependabot alert pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100&page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world returned an empty page before pagination finished/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts when pagination repeats the current URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 1,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-loop", severity: "high", summary: "Loop" },
            dependency: { package: { name: "pkg-loop" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/1",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: `<${firstURL}>; rel="next"`,
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts pagination for octocat\/hello-world repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alert links that are not alert links", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 1,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-home", severity: "high", summary: "Home" },
            dependency: { package: { name: "pkg-home" } },
            html_url: "https://github.com/octocat/hello-world",
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
        /must link to a Dependabot alert/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alert links with duplicate path separators", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 1,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-home", severity: "high", summary: "Home" },
            dependency: { package: { name: "pkg-home" } },
            html_url: "https://github.com/octocat//hello-world/security/dependabot/1",
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
        /must include a GitHub owner\/repo path/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed repository names before requiring a GitHub token for security alerts", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["bad owner/repo"]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

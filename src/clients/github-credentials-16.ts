import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listSecurityAlerts } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 16", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects Dependabot alerts missing summaries", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 10,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing-summary", severity: "high" },
            dependency: { package: { name: "pkg-missing-summary" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/10",
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
        /Dependabot alert 10 for octocat\/hello-world missing summary/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with non-string summaries", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 10,
            state: "open",
            security_advisory: {
              ghsa_id: "GHSA-bad-summary",
              severity: "high",
              summary: 123,
            },
            dependency: { package: { name: "pkg-bad-summary" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/10",
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
        /Dependabot alert 10 for octocat\/hello-world summary must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with surrounding whitespace in summaries", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 10,
            state: "open",
            security_advisory: {
              ghsa_id: "GHSA-padded-summary",
              severity: "high",
              summary: " padded summary ",
            },
            dependency: { package: { name: "pkg-padded-summary" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/10",
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
        /Dependabot alert 10 for octocat\/hello-world summary must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with surrounding whitespace in html_url", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 11,
            state: "open",
            security_advisory: {
              ghsa_id: "GHSA-padded-url",
              severity: "high",
              summary: "Padded alert URL",
            },
            dependency: { package: { name: "pkg-padded-url" } },
            html_url: " https://github.com/octocat/hello-world/security/dependabot/11 ",
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
        /Dependabot alert 11 for octocat\/hello-world html_url must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with surrounding whitespace in optional text fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    const cases = [
      {
        alert: {
          number: 12,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-padded-vrange",
            severity: "high",
            summary: "Padded vulnerable range",
          },
          dependency: { package: { name: "pkg-padded-vrange" } },
          security_vulnerability: { vulnerable_version_range: " < 1.2.3 " },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/12",
        },
        pattern:
          /Dependabot alert 12 for octocat\/hello-world vulnerable version range must not include surrounding whitespace/,
      },
      {
        alert: {
          number: 13,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-padded-patched",
            severity: "high",
            summary: "Padded patched version",
          },
          dependency: { package: { name: "pkg-padded-patched" } },
          security_vulnerability: { first_patched_version: { identifier: " 1.2.3 " } },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/13",
        },
        pattern:
          /Dependabot alert 13 for octocat\/hello-world patched version must not include surrounding whitespace/,
      },
      {
        alert: {
          number: 14,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-padded-manifest",
            severity: "high",
            summary: "Padded manifest path",
          },
          dependency: {
            package: { name: "pkg-padded-manifest" },
            manifest_path: " package-lock.json ",
          },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/14",
        },
        pattern:
          /Dependabot alert 14 for octocat\/hello-world manifest path must not include surrounding whitespace/,
      },
    ] as const;

    try {
      for (const { alert, pattern } of cases) {
        global.fetch = async (input: URL | Request | string) => {
          const url = typeof input === "string" ? input : input.toString();
          assert.equal(url, firstURL);

          return new Response(JSON.stringify([alert]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        };

        await assert.rejects(
          () => listSecurityAlerts(["octocat/hello-world"]),
          pattern,
        );
      }
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with non-string optional text fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    const cases = [
      {
        alert: {
          number: 12,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-vrange",
            severity: "high",
            summary: "Bad vulnerable range",
          },
          dependency: { package: { name: "pkg-bad-vrange" } },
          security_vulnerability: { vulnerable_version_range: 123 },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/12",
        },
        pattern:
          /Dependabot alert 12 for octocat\/hello-world vulnerable version range must be a string/,
      },
      {
        alert: {
          number: 13,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-patched",
            severity: "high",
            summary: "Bad patched version",
          },
          dependency: { package: { name: "pkg-bad-patched" } },
          security_vulnerability: { first_patched_version: { identifier: 123 } },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/13",
        },
        pattern:
          /Dependabot alert 13 for octocat\/hello-world patched version must be a string/,
      },
      {
        alert: {
          number: 14,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-manifest",
            severity: "high",
            summary: "Bad manifest path",
          },
          dependency: {
            package: { name: "pkg-bad-manifest" },
            manifest_path: 123,
          },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/14",
        },
        pattern:
          /Dependabot alert 14 for octocat\/hello-world manifest path must be a string/,
      },
    ] as const;

    try {
      for (const { alert, pattern } of cases) {
        global.fetch = async (input: URL | Request | string) => {
          const url = typeof input === "string" ? input : input.toString();
          assert.equal(url, firstURL);

          return new Response(JSON.stringify([alert]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        };

        await assert.rejects(
          () => listSecurityAlerts(["octocat/hello-world"]),
          pattern,
        );
      }
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with non-object nested optional records", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    const cases = [
      {
        alert: {
          number: 15,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-dependency-package",
            severity: "high",
            summary: "Bad dependency package",
          },
          dependency: { package: 123 },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/15",
        },
        pattern:
          /Dependabot alert 15 for octocat\/hello-world dependency package must be an object/,
      },
      {
        alert: {
          number: 16,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-vulnerability-package",
            severity: "high",
            summary: "Bad vulnerability package",
          },
          security_vulnerability: { package: 123 },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/16",
        },
        pattern:
          /Dependabot alert 16 for octocat\/hello-world vulnerability package must be an object/,
      },
      {
        alert: {
          number: 17,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-first-patched",
            severity: "high",
            summary: "Bad first patched version",
          },
          dependency: { package: { name: "pkg-bad-first-patched" } },
          security_vulnerability: { first_patched_version: 123 },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/17",
        },
        pattern:
          /Dependabot alert 17 for octocat\/hello-world first patched version must be an object/,
      },
    ] as const;

    try {
      for (const { alert, pattern } of cases) {
        global.fetch = async (input: URL | Request | string) => {
          const url = typeof input === "string" ? input : input.toString();
          assert.equal(url, firstURL);

          return new Response(JSON.stringify([alert]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        };

        await assert.rejects(
          () => listSecurityAlerts(["octocat/hello-world"]),
          pattern,
        );
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

});

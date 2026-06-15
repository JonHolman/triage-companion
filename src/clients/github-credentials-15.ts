import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listSecurityAlerts } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 15", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects Dependabot alerts with non-string package names", async () => {
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
            security_advisory: { ghsa_id: "GHSA-bad-pkg", severity: "high", summary: "Bad package" },
            dependency: { package: { name: 123 } },
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
        /Dependabot alert 7 for octocat\/hello-world package name must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed Dependabot package names even when another package source is valid", async () => {
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
            security_advisory: { ghsa_id: "GHSA-bad-pkg", severity: "high", summary: "Bad package" },
            dependency: { package: { name: 123 } },
            security_vulnerability: { package: { name: "valid-package" } },
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
        /Dependabot alert 7 for octocat\/hello-world package name must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with surrounding whitespace in package names", async () => {
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
            security_advisory: { ghsa_id: "GHSA-padded-pkg", severity: "high", summary: "Padded package" },
            dependency: { package: { name: " pkg-with-space " } },
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
        /Dependabot alert 7 for octocat\/hello-world package name must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts missing severities", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing-severity", summary: "Missing severity" },
            dependency: { package: { name: "pkg-missing-severity" } },
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
        /Dependabot alert 8 for octocat\/hello-world missing severity/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with non-string severities", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-bad-severity", severity: 123, summary: "Bad severity" },
            dependency: { package: { name: "pkg-bad-severity" } },
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
        /Dependabot alert 8 for octocat\/hello-world severity must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed Dependabot severities even when another severity source is valid", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-bad-severity", severity: "high", summary: "Bad severity" },
            security_vulnerability: { severity: 123 },
            dependency: { package: { name: "pkg-bad-severity" } },
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
        /Dependabot alert 8 for octocat\/hello-world severity must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with surrounding whitespace in severities", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-padded-severity", severity: " high ", summary: "Padded severity" },
            dependency: { package: { name: "pkg-padded-severity" } },
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
        /Dependabot alert 8 for octocat\/hello-world severity must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with unknown severity values", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-unknown-severity", severity: "moderate", summary: "Unknown severity" },
            dependency: { package: { name: "pkg-unknown-severity" } },
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
        /Dependabot alert 8 for octocat\/hello-world severity must be one of critical, high, medium, or low/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts missing GHSA ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 9,
            state: "open",
            security_advisory: { severity: "high", summary: "Missing GHSA" },
            dependency: { package: { name: "pkg-missing-ghsa" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/9",
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
        /Dependabot alert 9 for octocat\/hello-world missing GHSA id/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with non-string GHSA ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 9,
            state: "open",
            security_advisory: { ghsa_id: 123, severity: "high", summary: "Bad GHSA" },
            dependency: { package: { name: "pkg-bad-ghsa" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/9",
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
        /Dependabot alert 9 for octocat\/hello-world GHSA id must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with surrounding whitespace in GHSA ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 9,
            state: "open",
            security_advisory: { ghsa_id: " GHSA-padded-ghsa ", severity: "high", summary: "Padded GHSA" },
            dependency: { package: { name: "pkg-padded-ghsa" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/9",
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
        /Dependabot alert 9 for octocat\/hello-world GHSA id must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

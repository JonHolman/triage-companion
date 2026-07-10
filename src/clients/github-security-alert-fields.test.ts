import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listSecurityAlerts } from "./github.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import {
  DEPENDABOT_ALERTS_URL,
  dependabotAlertJson,
  jsonResponse,
  setupGitHubCredentialsTest,
} from "./github-credentials-test-support.ts";

describe("github security alert fields", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  async function expectAlertRejection(
    alert: Record<string, unknown>,
    pattern: RegExp,
  ): Promise<void> {
    const routes = routeHandler(new Map([
      [DEPENDABOT_ALERTS_URL, () => jsonResponse([alert])],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(() => listSecurityAlerts(["octocat/hello-world"]), pattern);
    });
  }

  test("rejects Dependabot alerts with non-string package names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(7, {
        security_advisory: { ghsa_id: "GHSA-bad-pkg", severity: "high", summary: "Bad package" },
        dependency: { package: { name: 123 } },
      }),
      /Dependabot alert 7 for octocat\/hello-world package name must be a string/,
    );
  });

  test("rejects malformed Dependabot package names even when another package source is valid", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(7, {
        security_advisory: { ghsa_id: "GHSA-bad-pkg", severity: "high", summary: "Bad package" },
        dependency: { package: { name: 123 } },
        security_vulnerability: { package: { name: "valid-package" } },
      }),
      /Dependabot alert 7 for octocat\/hello-world package name must be a string/,
    );
  });

  test("rejects Dependabot alerts with surrounding whitespace in package names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(7, {
        security_advisory: { ghsa_id: "GHSA-padded-pkg", severity: "high", summary: "Padded package" },
        dependency: { package: { name: " pkg-with-space " } },
      }),
      /Dependabot alert 7 for octocat\/hello-world package name must not include surrounding whitespace/,
    );
  });

  test("rejects Dependabot alerts missing severities", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(8, {
        security_advisory: { ghsa_id: "GHSA-missing-severity", summary: "Missing severity" },
        dependency: { package: { name: "pkg-missing-severity" } },
      }),
      /Dependabot alert 8 for octocat\/hello-world missing severity/,
    );
  });

  test("rejects Dependabot alerts with non-string severities", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(8, {
        security_advisory: { ghsa_id: "GHSA-bad-severity", severity: 123, summary: "Bad severity" },
        dependency: { package: { name: "pkg-bad-severity" } },
      }),
      /Dependabot alert 8 for octocat\/hello-world severity must be a string/,
    );
  });

  test("rejects malformed Dependabot severities even when another severity source is valid", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(8, {
        security_advisory: { ghsa_id: "GHSA-bad-severity", severity: "high", summary: "Bad severity" },
        security_vulnerability: { severity: 123 },
        dependency: { package: { name: "pkg-bad-severity" } },
      }),
      /Dependabot alert 8 for octocat\/hello-world severity must be a string/,
    );
  });

  test("rejects Dependabot alerts with surrounding whitespace in severities", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(8, {
        security_advisory: { ghsa_id: "GHSA-padded-severity", severity: " high ", summary: "Padded severity" },
        dependency: { package: { name: "pkg-padded-severity" } },
      }),
      /Dependabot alert 8 for octocat\/hello-world severity must not include surrounding whitespace/,
    );
  });

  test("rejects Dependabot alerts with unknown severity values", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(8, {
        security_advisory: { ghsa_id: "GHSA-unknown-severity", severity: "moderate", summary: "Unknown severity" },
        dependency: { package: { name: "pkg-unknown-severity" } },
      }),
      /Dependabot alert 8 for octocat\/hello-world severity must be one of critical, high, medium, or low/,
    );
  });

  test("rejects Dependabot alerts missing GHSA ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(9, {
        security_advisory: { severity: "high", summary: "Missing GHSA" },
        dependency: { package: { name: "pkg-missing-ghsa" } },
      }),
      /Dependabot alert 9 for octocat\/hello-world missing GHSA id/,
    );
  });

  test("rejects Dependabot alerts with non-string GHSA ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(9, {
        security_advisory: { ghsa_id: 123, severity: "high", summary: "Bad GHSA" },
        dependency: { package: { name: "pkg-bad-ghsa" } },
      }),
      /Dependabot alert 9 for octocat\/hello-world GHSA id must be a string/,
    );
  });

  test("rejects Dependabot alerts with surrounding whitespace in GHSA ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(9, {
        security_advisory: { ghsa_id: " GHSA-padded-ghsa ", severity: "high", summary: "Padded GHSA" },
        dependency: { package: { name: "pkg-padded-ghsa" } },
      }),
      /Dependabot alert 9 for octocat\/hello-world GHSA id must not include surrounding whitespace/,
    );
  });

  test("rejects Dependabot alerts missing summaries", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(10, {
        security_advisory: { ghsa_id: "GHSA-missing-summary", severity: "high" },
        dependency: { package: { name: "pkg-missing-summary" } },
      }),
      /Dependabot alert 10 for octocat\/hello-world missing summary/,
    );
  });

  test("rejects Dependabot alerts with non-string summaries", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(10, {
        security_advisory: { ghsa_id: "GHSA-bad-summary", severity: "high", summary: 123 },
        dependency: { package: { name: "pkg-bad-summary" } },
      }),
      /Dependabot alert 10 for octocat\/hello-world summary must be a string/,
    );
  });

  test("rejects Dependabot alerts with surrounding whitespace in summaries", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(10, {
        security_advisory: { ghsa_id: "GHSA-padded-summary", severity: "high", summary: " padded summary " },
        dependency: { package: { name: "pkg-padded-summary" } },
      }),
      /Dependabot alert 10 for octocat\/hello-world summary must not include surrounding whitespace/,
    );
  });

  test("rejects Dependabot alerts with surrounding whitespace in html_url", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertRejection(
      dependabotAlertJson(11, {
        security_advisory: { ghsa_id: "GHSA-padded-url", severity: "high", summary: "Padded alert URL" },
        dependency: { package: { name: "pkg-padded-url" } },
        html_url: " https://github.com/octocat/hello-world/security/dependabot/11 ",
      }),
      /Dependabot alert 11 for octocat\/hello-world html_url must not include surrounding whitespace/,
    );
  });

  test("rejects Dependabot alerts with surrounding whitespace in optional text fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const cases = [
      {
        alert: dependabotAlertJson(12, {
          security_advisory: { ghsa_id: "GHSA-padded-vrange", severity: "high", summary: "Padded vulnerable range" },
          dependency: { package: { name: "pkg-padded-vrange" } },
          security_vulnerability: { vulnerable_version_range: " < 1.2.3 " },
        }),
        pattern:
          /Dependabot alert 12 for octocat\/hello-world vulnerable version range must not include surrounding whitespace/,
      },
      {
        alert: dependabotAlertJson(13, {
          security_advisory: { ghsa_id: "GHSA-padded-patched", severity: "high", summary: "Padded patched version" },
          dependency: { package: { name: "pkg-padded-patched" } },
          security_vulnerability: { first_patched_version: { identifier: " 1.2.3 " } },
        }),
        pattern:
          /Dependabot alert 13 for octocat\/hello-world patched version must not include surrounding whitespace/,
      },
      {
        alert: dependabotAlertJson(14, {
          security_advisory: { ghsa_id: "GHSA-padded-manifest", severity: "high", summary: "Padded manifest path" },
          dependency: { package: { name: "pkg-padded-manifest" }, manifest_path: " package-lock.json " },
        }),
        pattern:
          /Dependabot alert 14 for octocat\/hello-world manifest path must not include surrounding whitespace/,
      },
    ] as const;

    for (const { alert, pattern } of cases) {
      await expectAlertRejection(alert, pattern);
    }
  });

  test("rejects Dependabot alerts with non-string optional text fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const cases = [
      {
        alert: dependabotAlertJson(12, {
          security_advisory: { ghsa_id: "GHSA-bad-vrange", severity: "high", summary: "Bad vulnerable range" },
          dependency: { package: { name: "pkg-bad-vrange" } },
          security_vulnerability: { vulnerable_version_range: 123 },
        }),
        pattern:
          /Dependabot alert 12 for octocat\/hello-world vulnerable version range must be a string/,
      },
      {
        alert: dependabotAlertJson(13, {
          security_advisory: { ghsa_id: "GHSA-bad-patched", severity: "high", summary: "Bad patched version" },
          dependency: { package: { name: "pkg-bad-patched" } },
          security_vulnerability: { first_patched_version: { identifier: 123 } },
        }),
        pattern:
          /Dependabot alert 13 for octocat\/hello-world patched version must be a string/,
      },
      {
        alert: dependabotAlertJson(14, {
          security_advisory: { ghsa_id: "GHSA-bad-manifest", severity: "high", summary: "Bad manifest path" },
          dependency: { package: { name: "pkg-bad-manifest" }, manifest_path: 123 },
        }),
        pattern:
          /Dependabot alert 14 for octocat\/hello-world manifest path must be a string/,
      },
    ] as const;

    for (const { alert, pattern } of cases) {
      await expectAlertRejection(alert, pattern);
    }
  });

  test("rejects Dependabot alerts with non-object nested optional records", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const cases = [
      {
        alert: dependabotAlertJson(15, {
          security_advisory: { ghsa_id: "GHSA-bad-dependency-package", severity: "high", summary: "Bad dependency package" },
          dependency: { package: 123 },
        }),
        pattern:
          /Dependabot alert 15 for octocat\/hello-world dependency package must be an object/,
      },
      {
        alert: dependabotAlertJson(16, {
          security_advisory: { ghsa_id: "GHSA-bad-vulnerability-package", severity: "high", summary: "Bad vulnerability package" },
          security_vulnerability: { package: 123 },
        }),
        pattern:
          /Dependabot alert 16 for octocat\/hello-world vulnerability package must be an object/,
      },
      {
        alert: dependabotAlertJson(17, {
          security_advisory: { ghsa_id: "GHSA-bad-first-patched", severity: "high", summary: "Bad first patched version" },
          dependency: { package: { name: "pkg-bad-first-patched" } },
          security_vulnerability: { first_patched_version: 123 },
        }),
        pattern:
          /Dependabot alert 17 for octocat\/hello-world first patched version must be an object/,
      },
    ] as const;

    for (const { alert, pattern } of cases) {
      await expectAlertRejection(alert, pattern);
    }
  });
});

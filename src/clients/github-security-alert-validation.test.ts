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

describe("github security alert validation", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  const invalidFieldsPattern =
    /GitHub Dependabot alerts response for octocat\/hello-world must contain alert objects with valid top-level fields/;

  async function expectAlertsRejection(body: unknown, pattern: RegExp): Promise<void> {
    const routes = routeHandler(new Map([
      [DEPENDABOT_ALERTS_URL, () => jsonResponse(body)],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(() => listSecurityAlerts(["octocat/hello-world"]), pattern);
    });
  }

  test("rejects malformed Dependabot alert responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      { data: [] },
      /GitHub Dependabot alerts response for octocat\/hello-world must be an array/,
    );
  });

  test("rejects invalid JSON Dependabot alert responses clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [DEPENDABOT_ALERTS_URL, () => new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world must be valid JSON/,
      );
    });
  });

  test("rejects Dependabot alert entries with invalid top-level fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection([{ state: 123 }], invalidFieldsPattern);
  });

  test("rejects Dependabot alert entries missing state", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      [dependabotAlertJson(123, { state: undefined })],
      invalidFieldsPattern,
    );
  });

  test("rejects Dependabot alert entries with empty states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection([dependabotAlertJson(123, { state: "" })], invalidFieldsPattern);
  });

  test("rejects Dependabot alert entries with whitespace-only states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection([dependabotAlertJson(123, { state: "   " })], invalidFieldsPattern);
  });

  test("rejects Dependabot alert entries with surrounding whitespace in states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection([dependabotAlertJson(123, { state: " open " })], invalidFieldsPattern);
  });

  test("rejects Dependabot alerts with non-open states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      [dependabotAlertJson(123, {
        state: "closed",
        security_advisory: { ghsa_id: "GHSA-1234", summary: "closed advisory" },
        security_vulnerability: { severity: "high" },
        dependency: { package: { name: "lodash" } },
      })],
      /Dependabot alert 123 for octocat\/hello-world must have state open/,
    );
  });

  test("rejects Dependabot alerts missing alert numbers", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      [dependabotAlertJson(1, {
        number: undefined,
        security_advisory: { ghsa_id: "GHSA-missing", severity: "high", summary: "Missing number" },
        dependency: { package: { name: "pkg-missing" } },
      })],
      invalidFieldsPattern,
    );
  });

  test("rejects Dependabot alerts missing html_url", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      [dependabotAlertJson(7, {
        html_url: undefined,
        security_advisory: { ghsa_id: "GHSA-missing-url", severity: "high", summary: "Missing URL" },
        dependency: { package: { name: "pkg-missing-url" } },
      })],
      invalidFieldsPattern,
    );
  });

  test("rejects Dependabot alerts with invalid alert numbers", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      [dependabotAlertJson(1, {
        number: 1.5,
        security_advisory: { ghsa_id: "GHSA-bad-number", severity: "high", summary: "Bad number" },
        dependency: { package: { name: "pkg-bad-number" } },
      })],
      invalidFieldsPattern,
    );
  });

  test("rejects Dependabot alert links that do not match the alert number", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      [dependabotAlertJson(7, {
        security_advisory: { ghsa_id: "GHSA-wrong", severity: "high", summary: "Wrong number" },
        dependency: { package: { name: "pkg-wrong" } },
        html_url: "https://github.com/octocat/hello-world/security/dependabot/8",
      })],
      /must link to Dependabot alert 7/,
    );
  });

  test("rejects Dependabot alerts missing package names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      [dependabotAlertJson(7, {
        security_advisory: { ghsa_id: "GHSA-missing-pkg", severity: "high", summary: "Missing package" },
      })],
      /Dependabot alert 7 for octocat\/hello-world missing package name/,
    );
  });

  test("rejects Dependabot alert links that are not alert links", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      [dependabotAlertJson(1, {
        security_advisory: { ghsa_id: "GHSA-home", severity: "high", summary: "Home" },
        dependency: { package: { name: "pkg-home" } },
        html_url: "https://github.com/octocat/hello-world",
      })],
      /must link to a Dependabot alert/,
    );
  });

  test("rejects Dependabot alert links with duplicate path separators", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectAlertsRejection(
      [dependabotAlertJson(1, {
        security_advisory: { ghsa_id: "GHSA-home", severity: "high", summary: "Home" },
        dependency: { package: { name: "pkg-home" } },
        html_url: "https://github.com/octocat//hello-world/security/dependabot/1",
      })],
      /must include a GitHub owner\/repo path/,
    );
  });
});

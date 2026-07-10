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

describe("github security alerts", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  test("reports Dependabot alert API failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse({ message: "Resource not accessible by token" }, { status: 403 }),
      async () => {
        await assert.rejects(
          () => listSecurityAlerts(["octocat/hello-world"]),
          /Could not list Dependabot security alerts: GitHub API HTTP 403 for octocat\/hello-world: Resource not accessible by token/,
        );
      },
    );
  });

  test("escapes control characters in Dependabot alert fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => {
      throw new Error("Bad\tgateway\nretry");
    }, async () => {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /Could not list Dependabot security alerts: Could not fetch GitHub Dependabot alerts for octocat\/hello-world: Bad\\tgateway, retry/,
          );
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    });
  });

  test("returns no Dependabot alerts without requiring a token when the repository list is empty", async () => {
    await withMockFetch(() => {
      throw new Error("unexpected network request");
    }, async () => {
      assert.deepEqual(await listSecurityAlerts([]), []);
    });
  });

  test("rejects Dependabot pagination links outside the current GitHub API route", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    let calls = 0;
    const routes = routeHandler(new Map([
      [DEPENDABOT_ALERTS_URL, () => jsonResponse([], {
        headers: { Link: "<https://example.com/repos/octocat/hello-world/dependabot/alerts?page=2>; rel=\"next\"" },
      })],
    ]));

    await withMockFetch((input) => {
      calls += 1;
      return routes(input);
    }, async () => {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub API URL must use https:\/\/api\.github\.com/,
      );
      assert.equal(calls, 1);
    });
  });

  test("rejects Dependabot pagination links that change the API query", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    let calls = 0;
    const routes = routeHandler(new Map([
      [DEPENDABOT_ALERTS_URL, () => jsonResponse([], {
        headers: {
          Link: "<https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=all&per_page=100&page=2>; rel=\"next\"",
        },
      })],
    ]));

    await withMockFetch((input) => {
      calls += 1;
      return routes(input);
    }, async () => {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub API pagination link must keep the current API query/,
      );
      assert.equal(calls, 1);
    });
  });

  test("rejects fractional Dependabot alert limits before API requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await assert.rejects(
      () => listSecurityAlerts(["octocat/hello-world"], { maxPerRepo: 0.5 }),
      /GitHub Dependabot alert limit must be a positive integer/,
    );
  });

  test("loads paginated Dependabot alerts and sorts highest severity first", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const secondURL = `${DEPENDABOT_ALERTS_URL}&after=Y3Vyc29yLTE`;
    let calls = 0;

    const routes = routeHandler(new Map([
      [DEPENDABOT_ALERTS_URL, () => jsonResponse([dependabotAlertJson(1, {
        security_advisory: { ghsa_id: "GHSA-low", severity: "low", summary: "Low issue" },
        dependency: { package: { name: "pkg-low" } },
      })], {
        headers: { Link: `<${secondURL}>; rel="next"` },
      })],
      [secondURL, () => jsonResponse([dependabotAlertJson(2, {
        security_advisory: { ghsa_id: "GHSA-critical", severity: "critical", summary: "Critical issue" },
        dependency: { package: { name: "pkg-critical" } },
      })])],
    ]));

    await withMockFetch((input) => {
      calls += 1;
      return routes(input);
    }, async () => {
      const alerts = await listSecurityAlerts(["octocat/hello-world", "octocat/hello-world"]);
      assert.equal(alerts.length, 2);
      assert.equal(alerts[0]?.severity, "critical");
      assert.equal(alerts[0]?.url, "https://github.com/octocat/hello-world/security/dependabot/2");
      assert.equal(alerts[1]?.severity, "low");
      assert.equal(calls, 2);
    });
  });

  test("rejects empty non-final Dependabot alert pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [DEPENDABOT_ALERTS_URL, () => jsonResponse([], {
        headers: { Link: `<${DEPENDABOT_ALERTS_URL}&after=Y3Vyc29yLTE>; rel="next"` },
      })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world returned an empty page before pagination finished/,
      );
    });
  });

  test("rejects Dependabot alerts when pagination repeats the current URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    let calls = 0;

    await withMockFetch((input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, DEPENDABOT_ALERTS_URL);
      return jsonResponse([dependabotAlertJson(1, {
        security_advisory: { ghsa_id: "GHSA-loop", severity: "high", summary: "Loop" },
        dependency: { package: { name: "pkg-loop" } },
      })], {
        headers: { Link: `<${DEPENDABOT_ALERTS_URL}>; rel="next"` },
      });
    }, async () => {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts pagination for octocat\/hello-world repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    });
  });
});

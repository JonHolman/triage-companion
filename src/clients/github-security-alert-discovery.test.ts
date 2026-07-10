import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listSecurityAlertNotificationRepositories } from "./github.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import { jsonResponse, setupGitHubCredentialsTest } from "./github-credentials-test-support.ts";

describe("github security alert discovery", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  const firstPageURL = "https://api.github.com/notifications?all=true&participating=false&per_page=100";

  function alertThreadNotification(id: string, repository: string): Record<string, unknown> {
    return {
      id,
      repository: {
        full_name: repository,
        html_url: `https://github.com/${repository.replace(" ", "-")}`,
      },
      subject: {
        type: "RepositoryDependabotAlertsThread",
        title: "Dependabot alert",
      },
      reason: "security_alert",
    };
  }

  test("discovers security alert repositories without rendering unrelated notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [firstPageURL, () => jsonResponse([
        {
          id: "1",
          repository: {
            full_name: "octocat/no-link",
            html_url: "https://github.com/octocat/no-link",
          },
          subject: {
            type: "UnknownThing",
            title: "No item URL",
          },
          reason: "subscribed",
        },
        alertThreadNotification("2", "octocat/alerted"),
      ])],
    ]));

    await withMockFetch(routes, async () => {
      assert.deepEqual(await listSecurityAlertNotificationRepositories(), ["octocat/alerted"]);
    });
  });

  test("rejects malformed repositories while discovering security alert notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([
        alertThreadNotification("1", "bad owner/repo"),
        alertThreadNotification("2", "octocat/alerted"),
      ]),
      async () => {
        await assert.rejects(
          () => listSecurityAlertNotificationRepositories(),
          /GitHub repository must be in owner\/repo form\./,
        );
      },
    );
  });

  test("rejects missing repositories while discovering security alert notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([
        {
          id: "1",
          subject: {
            type: "RepositoryDependabotAlertsThread",
            title: "Dependabot alert",
          },
          reason: "security_alert",
        },
      ]),
      async () => {
        await assert.rejects(
          () => listSecurityAlertNotificationRepositories(),
          /GitHub notification 1 missing repository name/,
        );
      },
    );
  });

  test("discovers security alert repositories beyond the first 200 notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    let calls = 0;
    const secondPageURL = "https://api.github.com/notifications?all=true&page=2&participating=false&per_page=100";
    const thirdPageURL = "https://api.github.com/notifications?all=true&page=3&participating=false&per_page=100";

    function issuePage(startID: number): Record<string, unknown>[] {
      return Array.from({ length: 100 }, (_, index) => ({
        id: String(index + startID),
        repository: {
          full_name: `octocat/repo-${index + startID}`,
          html_url: `https://github.com/octocat/repo-${index + startID}`,
        },
        subject: {
          type: "Issue",
          title: `Notification ${index + startID}`,
          url: `https://api.github.com/repos/octocat/repo-${index + startID}/issues/1`,
        },
        reason: "subscribed",
      }));
    }

    const routes = routeHandler(new Map([
      [firstPageURL, () => jsonResponse(issuePage(1), {
        headers: { Link: `<${secondPageURL}>; rel="next"` },
      })],
      [secondPageURL, () => jsonResponse(issuePage(101), {
        headers: { Link: `<${thirdPageURL}>; rel="next"` },
      })],
      [thirdPageURL, () => jsonResponse([alertThreadNotification("201", "octocat/alerted")])],
    ]));

    await withMockFetch((input) => {
      calls += 1;
      return routes(input);
    }, async () => {
      assert.deepEqual(await listSecurityAlertNotificationRepositories(), ["octocat/alerted"]);
      assert.equal(calls, 3);
    });
  });
});

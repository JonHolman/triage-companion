import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications } from "./github.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import {
  jsonResponse,
  notificationJson,
  notificationsUrl,
  setupGitHubCredentialsTest,
} from "./github-credentials-test-support.ts";

describe("github notification subjects", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  async function expectSingleFetchRejection(
    notification: Record<string, unknown>,
    pattern: RegExp,
  ): Promise<void> {
    let calls = 0;
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([notification])],
    ]));

    await withMockFetch((input) => {
      calls += 1;
      return routes(input);
    }, async () => {
      await assert.rejects(() => listNotifications({ maxResults: 1 }), pattern);
      assert.equal(calls, 1);
    });
  }

  test("rejects notification subject URLs outside the GitHub API without following them", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSingleFetchRejection(
      notificationJson({
        subject: {
          type: "PullRequest",
          title: "Unsafe URL",
          url: "https://example.com/repos/octocat/hello-world/pulls/1",
        },
      }),
      /GitHub API URL must use https:\/\/api\.github\.com/,
    );
  });

  test("rejects notification subject URLs that include credentials", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSingleFetchRejection(
      notificationJson({
        subject: {
          type: "Issue",
          title: "Credentialed API URL",
          url: "https://reader@api.github.com/repos/octocat/hello-world/issues/1",
        },
      }),
      /GitHub API URL must not include credentials/,
    );
  });

  test("rejects notification subject URLs that include ports", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSingleFetchRejection(
      notificationJson({
        subject: {
          type: "Issue",
          title: "Port API URL",
          url: "https://api.github.com:8443/repos/octocat/hello-world/issues/1",
        },
      }),
      /GitHub API URL must not include a port/,
    );
  });

  test("rejects notification subject URLs that include query strings", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSingleFetchRejection(
      notificationJson({
        subject: {
          type: "Issue",
          title: "Query API URL",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1?viewer=me",
        },
      }),
      /GitHub notification subject URL must not include query strings/,
    );
  });

  test("rejects notification subject URLs that include fragments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSingleFetchRejection(
      notificationJson({
        subject: {
          type: "Issue",
          title: "Fragment API URL",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1#ignored",
        },
      }),
      /GitHub API URL must not include fragments/,
    );
  });

  test("requires notification subject item links", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([notificationJson({
        subject: { type: "PullRequest", title: "No item URL" },
      })]),
      async () => {
        await assert.rejects(
          () => listNotifications({ maxResults: 1 }),
          /GitHub notification 1 missing GitHub web URL/,
        );
      },
    );
  });

  test("rejects notification subject URLs missing subject types clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([notificationJson({
        subject: {
          title: "Missing type",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
      })]),
      async () => {
        await assert.rejects(
          () => listNotifications({ maxResults: 1 }),
          /GitHub notification missing subject type/,
        );
      },
    );
  });

  test("rejects notifications missing subject types even without subject URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([notificationJson({
        subject: { title: "Missing type" },
        reason: "subscribed",
      })]),
      async () => {
        await assert.rejects(
          () => listNotifications({ maxResults: 1 }),
          /GitHub notification missing subject type/,
        );
      },
    );
  });

  test("rejects unsupported notification subject types without subject URLs clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([notificationJson({
        id: "2",
        subject: { type: "UnknownThing", title: "Unknown item without URL" },
        reason: "subscribed",
        updated_at: "2026-01-01T00:00:00Z",
      })]),
      async () => {
        await assert.rejects(
          () => listNotifications({ maxResults: 1 }),
          /GitHub notification 2 missing GitHub web URL\./,
        );
      },
    );
  });

  test("rejects unsupported notification subject types without echoing control characters", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([notificationJson({
        id: "2",
        subject: { type: "Unknown\tThing", title: "Unknown item without URL" },
      })]),
      async () => {
        await assert.rejects(
          () => listNotifications({ maxResults: 1 }),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(
              message,
              /GitHub notifications response entries must be objects with valid top-level fields\./,
            );
            assert.ok(!message.includes("\t"));
            return true;
          },
        );
      },
    );
  });

  test("links CheckSuite and Discussion notifications without subject URLs to repository pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([
        notificationJson({
          id: "3",
          subject: { type: "CheckSuite", title: "CI workflow run failed", url: null },
          reason: "ci_activity",
          updated_at: "2026-01-02T00:00:00Z",
        }),
        notificationJson({
          id: "4",
          subject: { type: "Discussion", title: "New discussion", url: null },
          reason: "subscribed",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      ]),
      async () => {
        const notifications = await listNotifications({ maxResults: 2 });
        assert.equal(notifications.length, 2);
        assert.equal(notifications[0]?.subjectType, "CheckSuite");
        assert.equal(notifications[0]?.webURL, "https://github.com/octocat/hello-world/actions");
        assert.equal(notifications[1]?.subjectType, "Discussion");
        assert.equal(notifications[1]?.webURL, "https://github.com/octocat/hello-world/discussions");
      },
    );
  });

  test("rejects notification subject API paths with extra path segments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([notificationJson({
        id: "3",
        subject: {
          type: "Issue",
          title: "Comment URL",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1/comments/2",
        },
      })]),
      async () => {
        await assert.rejects(
          () => listNotifications({ maxResults: 1 }),
          /GitHub notification subject URL is not a GitHub issue API URL/,
        );
      },
    );
  });

  test("rejects abbreviated commit notification subject URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([notificationJson({
        id: "3",
        subject: {
          type: "Commit",
          title: "Short commit",
          url: "https://api.github.com/repos/octocat/hello-world/commits/abc1234",
        },
      })]),
      async () => {
        await assert.rejects(
          () => listNotifications({ maxResults: 1 }),
          /GitHub notification subject URL is not a GitHub commit API URL/,
        );
      },
    );
  });

  test("rejects notification subject links for a different repository", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => jsonResponse([notificationJson({
        id: "4",
        subject: {
          type: "Issue",
          title: "Wrong repo",
          url: "https://api.github.com/repos/octocat/other/issues/1",
        },
      })]),
      async () => {
        await assert.rejects(
          () => listNotifications({ maxResults: 1 }),
          /GitHub notification subject URL must stay in the notification repository/,
        );
      },
    );
  });
});

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

describe("github pull request notification details", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  const pullDetailURL = "https://api.github.com/repos/octocat/hello-world/pulls/1";

  function pullRequestNotification(
    title: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return notificationJson({
      subject: { type: "PullRequest", title, url: pullDetailURL },
      ...overrides,
    });
  }

  async function expectPullDetailRejection(detailBody: unknown): Promise<void> {
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([pullRequestNotification("Fix bug", {
        reason: "author",
        updated_at: "2026-01-01T00:00:00Z",
      })])],
      [pullDetailURL, () => jsonResponse(detailBody)],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub pull request details response must be an object with valid top-level fields/,
      );
    });
  }

  async function expectPullUrlRejection(subjectURL: string, pattern: RegExp): Promise<void> {
    let calls = 0;
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([notificationJson({
        subject: { type: "PullRequest", title: "Unsafe PR URL", url: subjectURL },
      })])],
    ]));

    await withMockFetch((input) => {
      calls += 1;
      return routes(input);
    }, async () => {
      await assert.rejects(() => listNotifications({ maxResults: 1 }), pattern);
      assert.equal(calls, 1);
    });
  }

  test("does not fetch pull request details for a different repository", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    let calls = 0;

    await withMockFetch(() => {
      calls += 1;
      if (calls > 1) {
        throw new Error("unexpected pull request detail request");
      }

      return jsonResponse([notificationJson({
        id: "5",
        subject: {
          type: "PullRequest",
          title: "Wrong repo PR",
          url: "https://api.github.com/repos/octocat/other/pulls/1",
        },
      })]);
    }, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification pull request URL must stay in the notification repository/,
      );
      assert.equal(calls, 1);
    });
  });

  test("rejects pull request notification subject URLs with query strings before detail requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullUrlRejection(
      "https://api.github.com/repos/octocat/hello-world/pulls/1?viewer=me",
      /GitHub notification pull request URL must not include query strings/,
    );
  });

  test("rejects pull request notification subject URLs with duplicate path separators before detail requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullUrlRejection(
      "https://api.github.com/repos/octocat//hello-world/pulls/1",
      /GitHub notification pull request URL is not a GitHub pull request API URL/,
    );
  });

  test("rejects pull request notification subject URLs with dot path segments before detail requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullUrlRejection(
      "https://api.github.com/repos/octocat/%2E/hello-world/pulls/1",
      /GitHub notification pull request URL is not a GitHub pull request API URL/,
    );
  });

  test("rejects malformed pull request notification IDs before detail requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    let calls = 0;

    await withMockFetch(() => {
      calls += 1;
      if (calls > 1) {
        throw new Error("unexpected pull request detail request");
      }

      return jsonResponse([pullRequestNotification("Missing ID", { id: undefined })]);
    }, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response entries must be objects with valid top-level fields/,
      );
      assert.equal(calls, 1);
    });
  });

  test("rejects malformed pull request detail responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([pullRequestNotification("Malformed PR details")])],
      [pullDetailURL, () => jsonResponse([])],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub pull request details response must be an object/,
      );
    });
  });

  test("rejects pull request detail responses with invalid top-level fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([pullRequestNotification("Invalid PR details")])],
      [pullDetailURL, () => jsonResponse({ merged: "yes" })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub pull request details response must be an object with valid top-level fields/,
      );
    });
  });

  test("accepts pull request detail responses with a null user", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([pullRequestNotification("Deleted author PR", {
        reason: "author",
        updated_at: "2026-01-01T00:00:00Z",
      })])],
      [pullDetailURL, () => jsonResponse({ state: "open", merged: false, user: null })],
    ]));

    await withMockFetch(routes, async () => {
      const notifications = await listNotifications({ maxResults: 1 });
      assert.equal(notifications.length, 1);
    });
  });

  test("renders pull request notifications when optional detail lookup returns 404", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([pullRequestNotification("Inaccessible PR details", {
        reason: "author",
        updated_at: "2026-01-01T00:00:00Z",
      })])],
      [pullDetailURL, () => jsonResponse({ message: "Not Found" }, { status: 404 })],
    ]));

    await withMockFetch(routes, async () => {
      const notifications = await listNotifications({ maxResults: 1 });
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0]?.webURL, "https://github.com/octocat/hello-world/pull/1");
      assert.equal(notifications[0]?.subjectState, null);
      assert.equal(notifications[0]?.subjectMerged, null);
      assert.equal(notifications[0]?.subjectAuthorLogin, null);
    });
  });

  test("renders pull request notifications when optional detail lookup returns 403", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([pullRequestNotification("Forbidden PR details", {
        reason: "author",
        updated_at: "2026-01-01T00:00:00Z",
      })])],
      [pullDetailURL, () => jsonResponse({ message: "Resource not accessible by personal access token" }, { status: 403 })],
    ]));

    await withMockFetch(routes, async () => {
      const notifications = await listNotifications({ maxResults: 1 });
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0]?.webURL, "https://github.com/octocat/hello-world/pull/1");
      assert.equal(notifications[0]?.subjectState, null);
    });
  });

  test("rejects pull request detail responses missing author logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullDetailRejection({ state: "open", merged: false, user: {} });
  });

  test("rejects pull request detail responses with empty author logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullDetailRejection({ state: "open", merged: false, user: { login: "" } });
  });

  test("rejects pull request detail responses with whitespace-only author logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullDetailRejection({ state: "open", merged: false, user: { login: "   " } });
  });

  test("rejects pull request detail responses with surrounding whitespace in author logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullDetailRejection({ state: "open", merged: false, user: { login: " octocat " } });
  });

  test("rejects pull request detail responses with empty states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullDetailRejection({ state: "", merged: false, user: { login: "octocat" } });
  });

  test("rejects pull request detail responses with whitespace-only states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullDetailRejection({ state: "   ", merged: false });
  });

  test("rejects pull request detail responses with surrounding whitespace in states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullDetailRejection({ state: " open ", merged: false, user: { login: "octocat" } });
  });

  test("rejects pull request detail responses with unknown states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullDetailRejection({ state: "draft", merged: false, user: { login: "octocat" } });
  });

  test("rejects pull request detail responses that claim an open pull request is merged", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectPullDetailRejection({ state: "open", merged: true, user: { login: "octocat" } });
  });

  test("surfaces pull request detail API failures instead of dropping notification details", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([pullRequestNotification("Broken PR details")])],
      [pullDetailURL, () => jsonResponse({ message: "Broken PR details" }, { status: 502 })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub API HTTP 502 for notification pull request 1: Broken PR details/,
      );
    });
  });
});

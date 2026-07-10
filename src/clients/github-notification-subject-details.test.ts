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

describe("github notification subject details", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  const releaseDetailURL = "https://api.github.com/repos/octocat/hello-world/releases/2";

  function releaseNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return notificationJson({
      id: "2",
      subject: { type: "Release", title: "v1.0.0", url: releaseDetailURL },
      ...overrides,
    });
  }

  async function expectDetailRejection(detailBody: unknown, pattern: RegExp): Promise<void> {
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([releaseNotification()])],
      [releaseDetailURL, () => jsonResponse(detailBody)],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(() => listNotifications({ maxResults: 1 }), pattern);
    });
  }

  async function expectReleaseUrlRejection(subjectURL: string): Promise<void> {
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([releaseNotification({
        subject: { type: "Release", title: "v1.0.0", url: subjectURL },
      })])],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification subject URL is not a GitHub release API URL/,
      );
    });
  }

  test("resolves unsupported notification subject types with subject URLs from detail responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([notificationJson({
        id: "2",
        subject: {
          type: "UnknownThing",
          title: "Unknown item URL",
          url: "https://api.github.com/repos/octocat/hello-world/unknown/2",
        },
        reason: "subscribed",
        updated_at: "2026-01-01T00:00:00Z",
      })])],
      ["https://api.github.com/repos/octocat/hello-world/unknown/2", () => jsonResponse({
        html_url: "https://github.com/octocat/hello-world/security/code-scanning/2",
      })],
    ]));

    await withMockFetch(routes, async () => {
      const notifications = await listNotifications({ maxResults: 1 });
      assert.equal(notifications[0]?.subjectType, "UnknownThing");
      assert.equal(
        notifications[0]?.webURL,
        "https://github.com/octocat/hello-world/security/code-scanning/2",
      );
    });
  });

  test("resolves unrecognized notification subject links from detail responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([releaseNotification({
        reason: "subscribed",
        updated_at: "2026-01-01T00:00:00Z",
      })])],
      [releaseDetailURL, () => jsonResponse({
        html_url: "https://github.com/octocat/hello-world/releases/tag/v1.0.0",
      })],
    ]));

    await withMockFetch(routes, async () => {
      const notifications = await listNotifications({ maxResults: 1 });

      assert.equal(notifications[0]?.webURL, "https://github.com/octocat/hello-world/releases/tag/v1.0.0");
    });
  });

  test("rejects malformed notification subject detail responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectDetailRejection(
      [],
      /GitHub notification subject details response must be an object/,
    );
  });

  test("rejects notification subject detail responses without html_url", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectDetailRejection(
      {},
      /GitHub notification subject details response must include an html_url/,
    );
  });

  test("rejects notification subject detail responses with non-string html_url", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectDetailRejection(
      { html_url: 123 },
      /GitHub notification subject details response html_url must be a string/,
    );
  });

  test("rejects notification subject detail responses with surrounding whitespace in html_url", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectDetailRejection(
      { html_url: " https://github.com/octocat/hello-world/releases/tag/v1.0.0 " },
      /GitHub notification subject details response html_url must not include surrounding whitespace/,
    );
  });

  test("surfaces notification subject detail API failures instead of dropping subject links", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([releaseNotification()])],
      [releaseDetailURL, () => jsonResponse({ message: "Broken release details" }, { status: 503 })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub API HTTP 503 for notification subject details 2: Broken release details/,
      );
    });
  });

  test("escapes control characters in notification subject detail fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([releaseNotification()])],
      [releaseDetailURL, () => {
        throw new Error("Bad\trelease\ndetails");
      }],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /Could not fetch notification subject details 2: Bad\\trelease, details/,
          );
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    });
  });

  test("rejects release notification subject URLs that are not release API URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectReleaseUrlRejection("https://api.github.com/repos/octocat/hello-world/issues/2");
  });

  test("rejects release notification subject URLs with duplicate path separators", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectReleaseUrlRejection("https://api.github.com/repos/octocat//hello-world/releases/2");
  });

  test("rejects release notification subject URLs with dot path segments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectReleaseUrlRejection("https://api.github.com/repos/octocat/%2E/hello-world/releases/2");
  });

  test("rejects notification detail links with query strings", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([releaseNotification()])],
      [releaseDetailURL, () => jsonResponse({
        html_url: "https://github.com/octocat/hello-world/releases/tag/v1.0.0?expanded=true",
      })],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification 2 subject must not include query strings/,
      );
    });
  });

  test("accepts commit comment subject links whose html_url carries a fragment", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const commentDetailURL = "https://api.github.com/repos/octocat/hello-world/comments/44";
    const commentWebURL =
      "https://github.com/octocat/hello-world/commit/6dcb09b5b57875f334f61aebed695e2e4193db5e#commitcomment-44";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([notificationJson({
        id: "2",
        subject: { type: "CommitComment", title: "New comment", url: commentDetailURL },
        reason: "subscribed",
        updated_at: "2026-01-01T00:00:00Z",
      })])],
      [commentDetailURL, () => jsonResponse({ html_url: commentWebURL })],
    ]));

    await withMockFetch(routes, async () => {
      const notifications = await listNotifications({ maxResults: 1 });

      assert.equal(notifications[0]?.subjectType, "CommitComment");
      assert.equal(notifications[0]?.webURL, commentWebURL);
    });
  });
});

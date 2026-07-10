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

describe("github notifications", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  async function expectListRejection(payload: unknown, pattern: RegExp): Promise<void> {
    await withMockFetch(() => jsonResponse(payload), async () => {
      await assert.rejects(() => listNotifications({ maxResults: 1 }), pattern);
    });
  }

  test("rejects malformed GitHub notification responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection({ data: [] }, /GitHub notifications response must be an array/);
  });

  test("rejects invalid JSON GitHub notification responses clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => new Response("{", { status: 200, headers: { "Content-Type": "application/json" } }),
      async () => {
        await assert.rejects(
          () => listNotifications({ maxResults: 1 }),
          /GitHub notifications response must be valid JSON/,
        );
      },
    );
  });

  test("escapes control characters in notification fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => {
      throw new Error("Bad\tgateway\nretry");
    }, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /Could not fetch GitHub notifications: Bad\\tgateway, retry/);
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    });
  });

  test("rejects GitHub notification entries with invalid top-level fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [{ id: "1", unread: "yes" }],
      /GitHub notifications response entries must be objects with valid top-level fields/,
    );
  });

  test("rejects read notifications in unread-only GitHub notification fetches", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const routes = routeHandler(new Map([
      [notificationsUrl(1), () => jsonResponse([{ id: "1", unread: false }])],
    ]));

    await withMockFetch(routes, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response returned a read notification despite all=false/,
      );
    });
  });

  test("rejects GitHub notification entries with invalid numeric ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [{ id: 1.5, unread: true }],
      /GitHub notifications response entries must be objects with valid top-level fields/,
    );
  });

  test("rejects GitHub notification entries with surrounding whitespace in reasons", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [{ id: "1", reason: " subscribed ", unread: true }],
      /GitHub notifications response entries must be objects with valid top-level fields/,
    );
  });

  test("rejects GitHub notification entries with surrounding whitespace in subject titles", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [{ id: "1", subject: { type: "Issue", title: " padded title " }, unread: true }],
      /GitHub notifications response entries must be objects with valid top-level fields/,
    );
  });

  test("rejects GitHub notification entries with control characters in subject titles", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [{ id: "1", subject: { type: "Issue", title: "line 1\nline 2" }, unread: true }],
      /GitHub notifications response entries must be objects with valid top-level fields/,
    );
  });

  test("rejects GitHub notification entries with surrounding whitespace in subject URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [{
        id: "1",
        subject: {
          type: "Issue",
          title: "Issue update",
          url: " https://api.github.com/repos/octocat/hello-world/issues/1 ",
        },
        unread: true,
      }],
      /GitHub notifications response entries must be objects with valid top-level fields/,
    );
  });

  test("rejects GitHub notification entries with surrounding whitespace in repository URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [{
        id: "1",
        repository: {
          full_name: "octocat/hello-world",
          html_url: " https://github.com/octocat/hello-world ",
        },
        unread: true,
      }],
      /GitHub notifications response entries must be objects with valid top-level fields/,
    );
  });

  test("rejects fractional notification limits before API requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await assert.rejects(
      () => listNotifications({ maxResults: 0.5 }),
      /GitHub notification limit must be a positive integer/,
    );
  });

  test("requires notification thread IDs before rendering mark-read output", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [notificationJson({
        id: undefined,
        subject: {
          type: "Issue",
          title: "Missing ID",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
      })],
      /GitHub notifications response entries must be objects with valid top-level fields/,
    );
  });

  test("requires notification repository links to point at the repository root", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [notificationJson({
        id: "2",
        repository: {
          full_name: "octocat/hello-world",
          html_url: "https://github.com/octocat/hello-world/issues/1",
        },
        subject: {
          type: "Issue",
          title: "Repository link points to issue",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
      })],
      /GitHub notification 2 repository must link to the GitHub repository root/,
    );
  });

  test("rejects notifications missing repository names after link resolution", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [notificationJson({
        id: "2",
        repository: { html_url: "https://github.com/octocat/hello-world" },
        subject: {
          type: "Issue",
          title: "Missing repository name",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
        reason: "subscribed",
      })],
      /GitHub notification 2 missing repository name/,
    );
  });

  test("rejects notifications missing repository links after link resolution", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [notificationJson({
        id: "2",
        repository: { full_name: "octocat/hello-world" },
        subject: {
          type: "Issue",
          title: "Missing repository link",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
        reason: "subscribed",
      })],
      /GitHub notification 2 missing repository link/,
    );
  });

  test("rejects notifications missing subject titles after link resolution", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [notificationJson({
        id: "3",
        subject: {
          type: "Issue",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
        reason: "subscribed",
      })],
      /GitHub notification 3 missing subject title/,
    );
  });

  test("rejects notifications missing reasons after link resolution", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [notificationJson({
        id: "4",
        subject: {
          type: "Issue",
          title: "Missing reason",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
      })],
      /GitHub notification 4 missing reason/,
    );
  });

  test("rejects notifications missing unread state after link resolution", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [notificationJson({
        id: "5",
        subject: {
          type: "Issue",
          title: "Missing unread state",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
        reason: "subscribed",
        unread: undefined,
      })],
      /GitHub notification 5 missing unread state/,
    );
  });

  test("rejects notifications with invalid updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [notificationJson({
        id: "3",
        subject: {
          type: "Issue",
          title: "Broken timestamp",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
        reason: "subscribed",
        updated_at: "not-a-date",
      })],
      /GitHub notification 3 must include a valid updated_at timestamp/,
    );
  });

  test("rejects notifications with non-ISO updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectListRejection(
      [notificationJson({
        id: "3",
        subject: {
          type: "Issue",
          title: "Broken timestamp",
          url: "https://api.github.com/repos/octocat/hello-world/issues/1",
        },
        reason: "subscribed",
        updated_at: "1",
      })],
      /GitHub notification 3 must include a valid updated_at timestamp/,
    );
  });
});

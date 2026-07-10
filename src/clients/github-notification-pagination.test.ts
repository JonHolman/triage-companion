import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications } from "./github.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import {
  jsonResponse,
  notificationJson,
  notificationsUrl,
  setupGitHubCredentialsTest,
} from "./github-credentials-test-support.ts";

describe("github notification pagination", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  function pageNotification(id: string, title: string): Record<string, unknown> {
    return notificationJson({
      id,
      subject: {
        type: "Issue",
        title,
        url: "https://api.github.com/repos/octocat/hello-world/issues/1",
      },
    });
  }

  async function expectSinglePageRejection(
    payload: unknown,
    linkHeader: string,
    pattern: RegExp,
  ): Promise<void> {
    let calls = 0;
    await withMockFetch(() => {
      calls += 1;
      return jsonResponse(payload, { headers: { Link: linkHeader } });
    }, async () => {
      await assert.rejects(() => listNotifications({ maxResults: 2 }), pattern);
      assert.equal(calls, 1);
    });
  }

  test("rejects GitHub pagination links that include control characters", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSinglePageRejection(
      [pageNotification("7", "Control-char pagination")],
      "<https://api.github.com\t/notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
      /GitHub API URL must not include control characters\./,
    );
  });

  test("rejects notifications when pagination repeats the current URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const firstURL = notificationsUrl(2);
    let calls = 0;

    await withMockFetch((input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);
      return jsonResponse([pageNotification("6", "Loop")], {
        headers: { Link: `<${firstURL}>; rel="next"` },
      });
    }, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub notifications pagination repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    });
  });

  test("rejects notifications when pagination repeats the current URL with reordered query params", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const firstURL = notificationsUrl(2);
    let calls = 0;

    await withMockFetch((input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);
      return jsonResponse([pageNotification("6", "Loop")], {
        headers: {
          Link: "<https://api.github.com/notifications?participating=false&per_page=2&all=false>; rel=\"next\"",
        },
      });
    }, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub notifications pagination repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    });
  });

  test("rejects empty non-final notification pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await withMockFetch((input) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, notificationsUrl(2));
      return jsonResponse([], {
        headers: {
          Link: "<https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
        },
      });
    }, async () => {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub notifications response returned an empty page before pagination finished/,
      );
    });
  });

  test("rejects GitHub pagination links that include credentials", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSinglePageRejection(
      [pageNotification("7", "Credentialed pagination")],
      "<https://reader@api.github.com/notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
      /GitHub API URL must not include credentials/,
    );
  });

  test("rejects GitHub pagination links with surrounding whitespace inside the URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSinglePageRejection(
      [pageNotification("7", "Whitespace pagination")],
      "<https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2 >; rel=\"next\"",
      /GitHub API URL must not include surrounding whitespace/,
    );
  });

  test("rejects invalid GitHub pagination links clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSinglePageRejection(
      [pageNotification("7", "Bad pagination")],
      "<not a url>; rel=\"next\"",
      /GitHub API URL must be a valid https:\/\/api\.github\.com URL/,
    );
  });

  test("rejects GitHub pagination links with dot path segments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSinglePageRejection(
      [pageNotification("7", "Dot path pagination")],
      "<https://api.github.com/./notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
      /GitHub API pagination link must stay on the current API route/,
    );
  });

  test("rejects malformed GitHub pagination headers instead of stopping pagination early", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSinglePageRejection(
      [pageNotification("7", "Bad pagination header")],
      "https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2; rel=\"next\"",
      /GitHub API pagination link must be a valid URL/,
    );
  });

  test("rejects GitHub pagination links that include fragments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await expectSinglePageRejection(
      [pageNotification("8", "Fragment pagination")],
      "<https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2#ignored>; rel=\"next\"",
      /GitHub API URL must not include fragments/,
    );
  });
});

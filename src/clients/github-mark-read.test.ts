import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { markNotificationRead } from "./github.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import { setupGitHubCredentialsTest } from "./github-credentials-test-support.ts";

describe("github mark notification read", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  function rejectNetwork(): Response {
    throw new Error("unexpected network request");
  }

  test("rejects unsafe notification thread IDs before marking read", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => markNotificationRead("123/../../user"),
        /GitHub notification thread ID must be a positive number/,
      );
    });
  });

  test("rejects notification thread IDs with surrounding whitespace before marking read", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => markNotificationRead(" 123 "),
        /GitHub notification thread ID must be a positive number/,
      );
    });
  });

  test("rejects notification thread IDs with control characters without echoing them", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => markNotificationRead("123\t456"),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /GitHub notification thread ID must be a positive number\./);
          assert.ok(!message.includes("\t"));
          return true;
        },
      );
    });
  });

  test("rejects unsafe notification thread IDs before requiring a GitHub token", async () => {
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => markNotificationRead("123/../../user"),
        /GitHub notification thread ID must be a positive number/,
      );
    });
  });

  test("rejects zero notification thread IDs before marking read", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => markNotificationRead("0"),
        /GitHub notification thread ID must be a positive number/,
      );
    });
  });

  test("accepts large numeric notification thread IDs without safe-integer coercion", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const largeThreadID = "900719925474099312345";

    global.fetch = async (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, `https://api.github.com/notifications/threads/${largeThreadID}`);
      assert.equal(init?.method, "PATCH");
      return new Response(null, { status: 205 });
    };

    try {
      await markNotificationRead(largeThreadID);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("escapes control characters in markNotificationRead fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => {
      throw new Error("Bad\tgateway\nretry");
    }, async () => {
      await assert.rejects(
        () => markNotificationRead("123"),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /Could not mark GitHub notification 123 as read: Bad\\tgateway, retry/,
          );
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    });
  });
});

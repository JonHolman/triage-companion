import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications, markNotificationRead } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 03", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects notification thread IDs with control characters without echoing them", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => markNotificationRead("123\t456"),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /GitHub notification thread ID must be a positive number\./);
          assert.ok(!message.includes("\t"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects unsafe notification thread IDs before requiring a GitHub token", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => markNotificationRead("123/../../user"),
        /GitHub notification thread ID must be a positive number/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects zero notification thread IDs before marking read", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => markNotificationRead("0"),
        /GitHub notification thread ID must be a positive number/,
      );
    } finally {
      global.fetch = originalFetch;
    }
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
    const originalFetch = global.fetch;

    global.fetch = async () => {
      throw new Error("Bad\tgateway\nretry");
    };

    try {
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
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject URLs outside the GitHub API without following them", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=1");

      return new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "PullRequest",
              title: "Unsafe URL",
              url: "https://example.com/repos/octocat/hello-world/pulls/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub API URL must use https:\/\/api\.github\.com/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject URLs that include credentials", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=1");

      return new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Credentialed API URL",
              url: "https://reader@api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub API URL must not include credentials/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject URLs that include ports", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=1");

      return new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Port API URL",
              url: "https://api.github.com:8443/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub API URL must not include a port/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject URLs that include query strings", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=1");

      return new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Query API URL",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1?viewer=me",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification subject URL must not include query strings/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects GitHub pagination links that include control characters", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async () => {
      calls += 1;

      return new Response(
        JSON.stringify([
          {
            id: "7",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Control-char pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com\t/notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API URL must not include control characters\./,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject URLs that include fragments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=1");

      return new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Fragment API URL",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1#ignored",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub API URL must not include fragments/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("requires notification subject item links", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "PullRequest",
              title: "No item URL",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification 1 missing GitHub web URL/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

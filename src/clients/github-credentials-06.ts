import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 06", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("escapes control characters in notification subject detail fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.github.com/notifications?all=false&participating=false&per_page=1") {
        return new Response(
          JSON.stringify([
            {
              id: "2",
              repository: {
                full_name: "octocat/hello-world",
                html_url: "https://github.com/octocat/hello-world",
              },
              subject: {
                type: "Release",
                title: "v1.0.0",
                url: "https://api.github.com/repos/octocat/hello-world/releases/2",
              },
              unread: true,
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/releases/2");
      throw new Error("Bad\trelease\ndetails");
    };

    try {
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
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects release notification subject URLs that are not release API URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=1");
      return new Response(
        JSON.stringify([
          {
            id: "2",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Release",
              title: "v1.0.0",
              url: "https://api.github.com/repos/octocat/hello-world/issues/2",
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
        /GitHub notification subject URL is not a GitHub release API URL/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects release notification subject URLs with duplicate path separators", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=1");
      return new Response(
        JSON.stringify([
          {
            id: "2",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Release",
              title: "v1.0.0",
              url: "https://api.github.com/repos/octocat//hello-world/releases/2",
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
        /GitHub notification subject URL is not a GitHub release API URL/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects release notification subject URLs with dot path segments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=1");
      return new Response(
        JSON.stringify([
          {
            id: "2",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Release",
              title: "v1.0.0",
              url: "https://api.github.com/repos/octocat/%2E/hello-world/releases/2",
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
        /GitHub notification subject URL is not a GitHub release API URL/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification detail links with query strings", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.github.com/notifications?all=false&participating=false&per_page=1") {
        return new Response(
          JSON.stringify([
            {
              id: "2",
              repository: {
                full_name: "octocat/hello-world",
                html_url: "https://github.com/octocat/hello-world",
              },
              subject: {
                type: "Release",
                title: "v1.0.0",
                url: "https://api.github.com/repos/octocat/hello-world/releases/2",
              },
              unread: true,
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/releases/2");
      return new Response(
        JSON.stringify({
          html_url: "https://github.com/octocat/hello-world/releases/tag/v1.0.0?expanded=true",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification 2 subject must not include query strings or fragments/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject API paths with extra path segments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "3",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Comment URL",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1/comments/2",
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
        /GitHub notification subject URL is not a GitHub issue API URL/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects abbreviated commit notification subject URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "3",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Commit",
              title: "Short commit",
              url: "https://api.github.com/repos/octocat/hello-world/commits/abc1234",
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
        /GitHub notification subject URL is not a GitHub commit API URL/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject links for a different repository", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "4",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Wrong repo",
              url: "https://api.github.com/repos/octocat/other/issues/1",
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
        /GitHub notification subject URL must stay in the notification repository/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("does not fetch pull request details for a different repository", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async () => {
      calls += 1;
      if (calls > 1) {
        throw new Error("unexpected pull request detail request");
      }

      return new Response(
        JSON.stringify([
          {
            id: "5",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "PullRequest",
              title: "Wrong repo PR",
              url: "https://api.github.com/repos/octocat/other/pulls/1",
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
        /GitHub notification pull request URL must stay in the notification repository/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

});

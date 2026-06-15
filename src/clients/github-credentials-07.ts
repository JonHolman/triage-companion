import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 07", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects pull request notification subject URLs with query strings before detail requests", async () => {
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
              title: "Query PR URL",
              url: "https://api.github.com/repos/octocat/hello-world/pulls/1?viewer=me",
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
        /GitHub notification pull request URL must not include query strings/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects pull request notification subject URLs with duplicate path separators before detail requests", async () => {
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
              title: "Duplicate separator PR URL",
              url: "https://api.github.com/repos/octocat//hello-world/pulls/1",
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
        /GitHub notification pull request URL is not a GitHub pull request API URL/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects pull request notification subject URLs with dot path segments before detail requests", async () => {
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
              title: "Dot segment PR URL",
              url: "https://api.github.com/repos/octocat/%2E/hello-world/pulls/1",
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
        /GitHub notification pull request URL is not a GitHub pull request API URL/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed pull request notification IDs before detail requests", async () => {
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
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "PullRequest",
              title: "Missing ID",
              url: "https://api.github.com/repos/octocat/hello-world/pulls/1",
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
        /GitHub notifications response entries must be objects with valid top-level fields/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed pull request detail responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.github.com/notifications?all=false&participating=false&per_page=1") {
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
                title: "Malformed PR details",
                url: "https://api.github.com/repos/octocat/hello-world/pulls/1",
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

      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/1");
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub pull request details response must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects pull request detail responses with invalid top-level fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.github.com/notifications?all=false&participating=false&per_page=1") {
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
                title: "Invalid PR details",
                url: "https://api.github.com/repos/octocat/hello-world/pulls/1",
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

      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/1");
      return new Response(JSON.stringify({
        merged: "yes",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub pull request details response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects pull request detail responses missing author logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.github.com/notifications?all=false&participating=false&per_page=1") {
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
                title: "Fix bug",
                url: "https://api.github.com/repos/octocat/hello-world/pulls/1",
              },
              reason: "author",
              updated_at: "2026-01-01T00:00:00Z",
              unread: true,
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/1");
      return new Response(
        JSON.stringify({
          state: "open",
          merged: false,
          user: {},
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
        /GitHub pull request details response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects pull request detail responses with empty author logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.github.com/notifications?all=false&participating=false&per_page=1") {
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
                title: "Fix bug",
                url: "https://api.github.com/repos/octocat/hello-world/pulls/1",
              },
              reason: "author",
              updated_at: "2026-01-01T00:00:00Z",
              unread: true,
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/1");
      return new Response(
        JSON.stringify({
          state: "open",
          merged: false,
          user: { login: "" },
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
        /GitHub pull request details response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

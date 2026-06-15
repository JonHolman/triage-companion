import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 05", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects unsupported notification subject types without subject URLs clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "2",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "UnknownThing",
              title: "Unknown item without URL",
            },
            reason: "subscribed",
            updated_at: "2026-01-01T00:00:00Z",
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
        /GitHub notification 2 missing GitHub web URL\./,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects unsupported notification subject types without echoing control characters", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "2",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Unknown\tThing",
              title: "Unknown item without URL",
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
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("resolves unrecognized notification subject links from detail responses", async () => {
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
              reason: "subscribed",
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

      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/releases/2");
      return new Response(
        JSON.stringify({
          html_url: "https://github.com/octocat/hello-world/releases/tag/v1.0.0",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      const notifications = await listNotifications({ maxResults: 1 });

      assert.equal(notifications[0]?.webURL, "https://github.com/octocat/hello-world/releases/tag/v1.0.0");
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed notification subject detail responses", async () => {
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
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification subject details response must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject detail responses without html_url", async () => {
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
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification subject details response must include an html_url/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject detail responses with non-string html_url", async () => {
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
      return new Response(JSON.stringify({ html_url: 123 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification subject details response html_url must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notification subject detail responses with surrounding whitespace in html_url", async () => {
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
      return new Response(JSON.stringify({ html_url: " https://github.com/octocat/hello-world/releases/tag/v1.0.0 " }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification subject details response html_url must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("surfaces notification subject detail API failures instead of dropping subject links", async () => {
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
      return new Response(JSON.stringify({ message: "Broken release details" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub API HTTP 503 for notification subject details 2: Broken release details/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

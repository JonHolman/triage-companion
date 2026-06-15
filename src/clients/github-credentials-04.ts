import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 04", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects notification subject URLs missing subject types clearly", async () => {
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
              title: "Missing type",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
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
        /GitHub notification missing subject type/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications missing subject types even without subject URLs", async () => {
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
              title: "Missing type",
            },
            reason: "subscribed",
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
        /GitHub notification missing subject type/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("requires notification thread IDs before rendering mark-read output", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Missing ID",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
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
        /GitHub notifications response entries must be objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("requires notification repository links to point at the repository root", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
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
        /GitHub notification 2 repository must link to the GitHub repository root/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications missing repository names after link resolution", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "2",
            repository: {
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Missing repository name",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            reason: "subscribed",
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
        /GitHub notification 2 missing repository name/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications missing repository links after link resolution", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "2",
            repository: {
              full_name: "octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Missing repository link",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            reason: "subscribed",
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
        /GitHub notification 2 missing repository link/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications missing subject titles after link resolution", async () => {
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
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            reason: "subscribed",
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
        /GitHub notification 3 missing subject title/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications missing reasons after link resolution", async () => {
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
              title: "Missing reason",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
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
        /GitHub notification 4 missing reason/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications missing unread state after link resolution", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "5",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Missing unread state",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            reason: "subscribed",
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
        /GitHub notification 5 missing unread state/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("resolves unsupported notification subject types with subject URLs from detail responses", async () => {
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
                type: "UnknownThing",
                title: "Unknown item URL",
                url: "https://api.github.com/repos/octocat/hello-world/unknown/2",
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

      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/unknown/2");
      return new Response(
        JSON.stringify({
          html_url: "https://github.com/octocat/hello-world/security/code-scanning/2",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      const notifications = await listNotifications({ maxResults: 1 });
      assert.equal(notifications[0]?.subjectType, "UnknownThing");
      assert.equal(
        notifications[0]?.webURL,
        "https://github.com/octocat/hello-world/security/code-scanning/2",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications, listSecurityAlerts, markNotificationRead } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 02", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects GitHub notification entries with invalid numeric ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify([
        {
          id: 1.5,
          unread: true,
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response entries must be objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects GitHub notification entries with surrounding whitespace in reasons", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify([
        {
          id: "1",
          reason: " subscribed ",
          unread: true,
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response entries must be objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects GitHub notification entries with surrounding whitespace in subject titles", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify([
        {
          id: "1",
          subject: {
            type: "Issue",
            title: " padded title ",
          },
          unread: true,
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response entries must be objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects GitHub notification entries with control characters in subject titles", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify([
        {
          id: "1",
          subject: {
            type: "Issue",
            title: "line 1\nline 2",
          },
          unread: true,
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response entries must be objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects GitHub notification entries with surrounding whitespace in subject URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify([
        {
          id: "1",
          subject: {
            type: "Issue",
            title: "Issue update",
            url: " https://api.github.com/repos/octocat/hello-world/issues/1 ",
          },
          unread: true,
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response entries must be objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects GitHub notification entries with surrounding whitespace in repository URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify([
        {
          id: "1",
          repository: {
            full_name: "octocat/hello-world",
            html_url: " https://github.com/octocat/hello-world ",
          },
          unread: true,
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response entries must be objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects fractional notification limits before API requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await assert.rejects(
      () => listNotifications({ maxResults: 0.5 }),
      /GitHub notification limit must be a positive integer/,
    );
  });


  test("rejects malformed Dependabot alert responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world must be an array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects invalid JSON Dependabot alert responses clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world must be valid JSON/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alert entries with invalid top-level fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify([{
        state: 123,
      }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alert entries missing state", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            number: 123,
            html_url: "https://github.com/octocat/hello-world/security/dependabot/123",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alert entries with empty states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            number: 123,
            state: "",
            html_url: "https://github.com/octocat/hello-world/security/dependabot/123",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alert entries with whitespace-only states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            number: 123,
            state: "   ",
            html_url: "https://github.com/octocat/hello-world/security/dependabot/123",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alert entries with surrounding whitespace in states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            number: 123,
            state: " open ",
            html_url: "https://github.com/octocat/hello-world/security/dependabot/123",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with non-open states", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            number: 123,
            state: "closed",
            html_url: "https://github.com/octocat/hello-world/security/dependabot/123",
            security_advisory: {
              ghsa_id: "GHSA-1234",
              summary: "closed advisory",
            },
            security_vulnerability: {
              severity: "high",
            },
            dependency: {
              package: {
                name: "lodash",
              },
            },
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 123 for octocat\/hello-world must have state open/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects unsafe notification thread IDs before marking read", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
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


  test("rejects notification thread IDs with surrounding whitespace before marking read", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => markNotificationRead(" 123 "),
        /GitHub notification thread ID must be a positive number/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

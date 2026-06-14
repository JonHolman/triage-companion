import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import {
  hasToken,
  listNotifications,
  listFailedWorkflowRuns,
  listSecurityAlerts,
  listSecurityAlertNotificationRepositories,
  markNotificationRead,
  resolveAuthenticatedLogin,
  saveToken,
} from "./github.ts";
import { resetCache, save } from "../credential-store.ts";

let originalConfigDir: string | undefined;
let originalToken: string | undefined;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalToken = process.env.GITHUB_TOKEN;

  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-credentials-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  delete process.env.GITHUB_TOKEN;
  resetCache();
});

afterEach(() => {
  resetCache();

  if (originalConfigDir === undefined) {
    delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
  } else {
    process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
  }

  if (originalToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = originalToken;
  }

  fs.rmSync(testDir, { force: true, recursive: true });
});

describe("github credentials", () => {
  test("uses persisted token when available", () => {
    saveToken("github-token-abc");
    assert.equal(hasToken(), true);
  });

  test("uses env token when store is empty", () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    assert.equal(hasToken(), true);
  });

  test("does not use env token when the persisted store is unreadable", async () => {
    fs.mkdirSync(path.dirname(path.join(testDir, "secrets.json")), { recursive: true });
    fs.writeFileSync(path.join(testDir, "secrets.json"), "not json", "utf-8");
    resetCache();
    process.env.GITHUB_TOKEN = "github-env-token";

    assert.equal(hasToken(), false);
    await assert.rejects(
      () => resolveAuthenticatedLogin(),
      /Credential store .* is not valid JSON/,
    );
  });

  test("returns false when the persisted store is unreadable and no env token is set", () => {
    fs.mkdirSync(path.dirname(path.join(testDir, "secrets.json")), { recursive: true });
    fs.writeFileSync(path.join(testDir, "secrets.json"), "not json", "utf-8");
    resetCache();

    assert.equal(hasToken(), false);
  });

  test("rejects empty token values", () => {
    assert.throws(() => saveToken("   "), /GitHub token is required/);
    assert.equal(hasToken(), false);
  });

  test("rejects saved GitHub tokens with surrounding whitespace", () => {
    assert.throws(() => saveToken(" github-token "), /GitHub token must not include surrounding whitespace/);
    assert.equal(hasToken(), false);
  });

  test("rejects GitHub tokens with control characters before API requests", async () => {
    process.env.GITHUB_TOKEN = "github\n-env-token";

    await assert.rejects(
      () => resolveAuthenticatedLogin(),
      /GitHub token must not include control characters/,
    );
    assert.equal(hasToken(), false);
  });

  test("rejects GitHub tokens with surrounding whitespace before API requests", async () => {
    process.env.GITHUB_TOKEN = " github-env-token ";

    await assert.rejects(
      () => resolveAuthenticatedLogin(),
      /GitHub token must not include surrounding whitespace/,
    );
    assert.equal(hasToken(), false);
  });

  test("rejects stored GitHub tokens with surrounding whitespace before API requests", async () => {
    save("Triage Companion-GitHub", "notifications-token", " github-stored-token ");

    await assert.rejects(
      () => resolveAuthenticatedLogin(),
      /GitHub token must not include surrounding whitespace/,
    );
    assert.equal(hasToken(), false);
  });

  test("resolves the authenticated login from token", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url !== "https://api.github.com/user") {
        throw new Error(`Unexpected GitHub route: ${url}`);
      }
      assert.equal(init?.redirect, "error");

      return new Response(JSON.stringify({ login: "octocat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      assert.equal(await resolveAuthenticatedLogin(), "octocat");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("reports authenticated login API failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub API HTTP 401: Bad credentials/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("escapes control characters in authenticated login fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("Bad\tcredentials\nretry");
    };

    try {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /Could not resolve the authenticated GitHub login: Bad\\tcredentials, retry/,
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

  test("rejects blank authenticated login API error messages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ message: "   " }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub API HTTP 401: GitHub API error response message must be non-empty text without surrounding whitespace or control characters/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("escapes control characters in raw authenticated login API error payloads", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response("bad\tcredentials\nretry", {
        status: 401,
        headers: { "Content-Type": "text/plain" },
      });

    try {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /GitHub API HTTP 401: bad\\tcredentials, retry/);
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed authenticated user responses clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub authenticated user response must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects authenticated user responses with surrounding whitespace in logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ login: " octocat " }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub authenticated user response login must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects authenticated user responses with empty logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ login: "   " }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub authenticated user response login must not be empty/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects authenticated user responses with control characters in logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ login: "octo\tcat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub authenticated user response login must not include control characters/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("reports Dependabot alert API failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ message: "Resource not accessible by token" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Could not list Dependabot security alerts: GitHub API HTTP 403 for octocat\/hello-world: Resource not accessible by token/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("escapes control characters in Dependabot alert fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("Bad\tgateway\nretry");
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /Could not list Dependabot security alerts: Could not fetch GitHub Dependabot alerts for octocat\/hello-world: Bad\\tgateway, retry/,
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

  test("returns no Dependabot alerts without requiring a token when the repository list is empty", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      assert.deepEqual(await listSecurityAlerts([]), []);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed GitHub notification responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response must be an array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects invalid JSON GitHub notification responses clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response must be valid JSON/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("escapes control characters in notification fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("Bad\tgateway\nretry");
    };

    try {
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
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects GitHub notification entries with invalid top-level fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify([
        {
          id: "1",
          unread: "yes",
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

  test("rejects read notifications in unread-only GitHub notification fetches", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=1");
      return new Response(JSON.stringify([
        {
          id: "1",
          unread: false,
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notifications response returned a read notification despite all=false/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

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

  test("rejects pull request detail responses with whitespace-only author logins", async () => {
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
          user: { login: "   " },
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

  test("rejects pull request detail responses with surrounding whitespace in author logins", async () => {
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
          user: { login: " octocat " },
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

  test("rejects pull request detail responses with empty states", async () => {
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
          state: "",
          merged: false,
          user: { login: "octocat" },
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

  test("rejects pull request detail responses with whitespace-only states", async () => {
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
          state: "   ",
          merged: false,
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

  test("rejects pull request detail responses with surrounding whitespace in states", async () => {
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
          state: " open ",
          merged: false,
          user: { login: "octocat" },
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

  test("rejects pull request detail responses with unknown states", async () => {
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
          state: "draft",
          merged: false,
          user: { login: "octocat" },
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

  test("rejects pull request detail responses that claim an open pull request is merged", async () => {
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
          merged: true,
          user: { login: "octocat" },
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

  test("surfaces pull request detail API failures instead of dropping notification details", async () => {
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
                title: "Broken PR details",
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
      return new Response(JSON.stringify({ message: "Broken PR details" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub API HTTP 502 for notification pull request 1: Broken PR details/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects notifications with invalid updated_at timestamps", async () => {
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
              title: "Broken timestamp",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            reason: "subscribed",
            updated_at: "not-a-date",
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
        /GitHub notification 3 must include a valid updated_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects notifications with non-ISO updated_at timestamps", async () => {
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
              title: "Broken timestamp",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            reason: "subscribed",
            updated_at: "1",
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
        /GitHub notification 3 must include a valid updated_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects notifications when pagination repeats the current URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/notifications?all=false&participating=false&per_page=2";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            id: "6",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Loop",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: `<${firstURL}>; rel="next"`,
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub notifications pagination repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects notifications when pagination repeats the current URL with reordered query params", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/notifications?all=false&participating=false&per_page=2";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            id: "6",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Loop",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?participating=false&per_page=2&all=false>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub notifications pagination repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects empty non-final notification pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=2");

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub notifications response returned an empty page before pagination finished/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects GitHub pagination links that include credentials", async () => {
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
              title: "Credentialed pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://reader@api.github.com/notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API URL must not include credentials/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects GitHub pagination links with surrounding whitespace inside the URL", async () => {
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
              title: "Whitespace pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2 >; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API URL must not include surrounding whitespace/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects invalid GitHub pagination links clearly", async () => {
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
              title: "Bad pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<not a url>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API URL must be a valid https:\/\/api\.github\.com URL/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects GitHub pagination links with dot path segments", async () => {
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
              title: "Dot path pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/./notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API pagination link must stay on the current API route/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed GitHub pagination headers instead of stopping pagination early", async () => {
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
              title: "Bad pagination header",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API pagination link must be a valid URL/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects GitHub pagination links that include fragments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify([
          {
            id: "8",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Fragment pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2#ignored>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API URL must not include fragments/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("discovers security alert repositories without rendering unrelated notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/notifications?all=true&participating=false&per_page=100");

      return new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "octocat/no-link",
              html_url: "https://github.com/octocat/no-link",
            },
            subject: {
              type: "UnknownThing",
              title: "No item URL",
            },
            reason: "subscribed",
          },
          {
            id: "2",
            repository: {
              full_name: "octocat/alerted",
              html_url: "https://github.com/octocat/alerted",
            },
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      assert.deepEqual(await listSecurityAlertNotificationRepositories(), ["octocat/alerted"]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed repositories while discovering security alert notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "bad owner/repo",
              html_url: "https://github.com/bad-owner/repo",
            },
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
          {
            id: "2",
            repository: {
              full_name: "octocat/alerted",
              html_url: "https://github.com/octocat/alerted",
            },
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listSecurityAlertNotificationRepositories(),
        /GitHub repository must be in owner\/repo form\./,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects missing repositories while discovering security alert notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "1",
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listSecurityAlertNotificationRepositories(),
        /GitHub notification 1 missing repository name/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("discovers security alert repositories beyond the first 200 notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    const nonAlertPage = Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1),
      repository: {
        full_name: `octocat/repo-${index + 1}`,
        html_url: `https://github.com/octocat/repo-${index + 1}`,
      },
      subject: {
        type: "Issue",
        title: `Notification ${index + 1}`,
        url: `https://api.github.com/repos/octocat/repo-${index + 1}/issues/1`,
      },
      reason: "subscribed",
    }));

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;

      if (url === "https://api.github.com/notifications?all=true&participating=false&per_page=100") {
        return new Response(JSON.stringify(nonAlertPage), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?all=true&page=2&participating=false&per_page=100>; rel=\"next\"",
          },
        });
      }

      if (url === "https://api.github.com/notifications?all=true&page=2&participating=false&per_page=100") {
        return new Response(JSON.stringify(nonAlertPage.map((item, index) => ({
          ...item,
          id: String(index + 101),
          repository: {
            full_name: `octocat/repo-${index + 101}`,
            html_url: `https://github.com/octocat/repo-${index + 101}`,
          },
          subject: {
            ...item.subject,
            title: `Notification ${index + 101}`,
            url: `https://api.github.com/repos/octocat/repo-${index + 101}/issues/1`,
          },
        }))), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?all=true&page=3&participating=false&per_page=100>; rel=\"next\"",
          },
        });
      }

      if (url === "https://api.github.com/notifications?all=true&page=3&participating=false&per_page=100") {
        return new Response(JSON.stringify([
          {
            id: "201",
            repository: {
              full_name: "octocat/alerted",
              html_url: "https://github.com/octocat/alerted",
            },
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
        ]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`unexpected url ${url}`);
    };

    try {
      assert.deepEqual(await listSecurityAlertNotificationRepositories(), ["octocat/alerted"]);
      assert.equal(calls, 3);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot pagination links outside the current GitHub API route", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100");

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://example.com/repos/octocat/hello-world/dependabot/alerts?page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub API URL must use https:\/\/api\.github\.com/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot pagination links that change the API query", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100");

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=all&per_page=100&page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub API pagination link must keep the current API query/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects fractional Dependabot alert limits before API requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await assert.rejects(
      () => listSecurityAlerts(["octocat/hello-world"], { maxPerRepo: 0.5 }),
      /GitHub Dependabot alert limit must be a positive integer/,
    );
  });

  test("loads recent failed workflow runs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=2");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "fix bug",
              head_branch: "feature",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      const runs = await listFailedWorkflowRuns(["octocat/hello-world", "octocat/hello-world"], { maxPerRepo: 2 });
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.url, "https://github.com/octocat/hello-world/actions/runs/123");
      assert.equal(runs[0]?.conclusion, "failure");
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with non-failure conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 124,
              name: "CI",
              display_title: "success",
              head_branch: "main",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/octocat/hello-world/actions/runs/124",
              updated_at: "2026-01-02T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must have conclusion failure/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with non-completed statuses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "queued but marked failed",
              status: "queued",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              updated_at: "2025-01-02T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must have status completed/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("returns no failed workflow runs without requiring a token when the repository list is empty", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      assert.deepEqual(await listFailedWorkflowRuns([]), []);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("escapes control characters in failed workflow fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () => {
      throw new Error("Bad\tgateway\nretry");
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /Could not fetch GitHub workflow runs for octocat\/hello-world: Bad\\tgateway, retry/,
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

  test("rejects fractional failed workflow limits before API requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await assert.rejects(
      () => listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 0.5 }),
      /GitHub failed workflow limit must be a positive integer/,
    );
  });

  test("caps failed workflow request page size at GitHub maximum", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=100");
      return new Response(JSON.stringify({ workflow_runs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      assert.deepEqual(
        await listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 250 }),
        [],
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("paginates failed workflow runs when the requested limit exceeds GitHub page size", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    const firstPageRuns = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: "CI",
      display_title: `failure ${index + 1}`,
      status: "completed",
      conclusion: "failure",
      html_url: `https://github.com/octocat/hello-world/actions/runs/${index + 1}`,
      updated_at: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;

      if (url === "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=100") {
        return new Response(JSON.stringify({ workflow_runs: firstPageRuns }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=100&page=2>; rel=\"next\"",
          },
        });
      }

      if (url === "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=100&page=2") {
        return new Response(JSON.stringify({
          workflow_runs: [
            {
              id: 101,
              name: "CI",
              display_title: "failure 101",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/101",
              updated_at: "2026-02-01T00:00:00Z",
            },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`unexpected workflow runs url ${url}`);
    };

    try {
      const runs = await listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 101 });
      assert.equal(runs.length, 101);
      assert.equal(calls, 2);
      assert.ok(runs.some((run) => run.url === "https://github.com/octocat/hello-world/actions/runs/101"));
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects empty non-final failed workflow pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=2");

      return new Response(JSON.stringify({
        workflow_runs: [],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=2&page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 2 }),
        /GitHub workflow runs response for octocat\/hello-world returned an empty page before pagination finished/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow runs when pagination repeats the current URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=2";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);

      return new Response(JSON.stringify({
        workflow_runs: [
          {
            id: 123,
            name: "CI",
            display_title: "loop",
            head_branch: "feature",
            status: "completed",
            conclusion: "failure",
            html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: `<${firstURL}>; rel="next"`,
        },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"], { maxPerRepo: 2 }),
        /GitHub workflow runs pagination for octocat\/hello-world repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed failed workflow responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify({ workflow_runs: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must include a workflow_runs array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects invalid JSON failed workflow responses clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must be valid JSON/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow responses that are not objects", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must include a workflow_runs array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries that are not objects", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify({ workflow_runs: [null] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with invalid top-level fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify({
        workflow_runs: [
          {
            id: "123",
            conclusion: "failure",
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries missing conclusion", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              status: "completed",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries missing names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              display_title: "missing name",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries missing statuses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "missing status",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries missing run ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              name: "CI",
              display_title: "missing id",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries missing workflow URLs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "missing html_url",
              status: "completed",
              conclusion: "failure",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with empty conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "empty conclusion",
              status: "completed",
              conclusion: "",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with whitespace-only conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "Fix bug",
              status: "completed",
              conclusion: "   ",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with surrounding whitespace in conclusions", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "Fix bug",
              status: "completed",
              conclusion: " failure ",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with invalid updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "broken updated_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              updated_at: "not-a-date",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must include a valid updated_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with non-ISO updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "broken updated_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              updated_at: "1",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must include a valid updated_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries missing updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "missing updated_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with invalid created_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "broken created_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              created_at: "not-a-date",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must include a valid created_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with impossible created_at calendar dates", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "broken created_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              created_at: "2026-02-31T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow run for octocat\/hello-world must include a valid created_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with empty created_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "empty created_at",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123",
              created_at: "",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow responses missing workflow runs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");
      return new Response(JSON.stringify({ total_count: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /GitHub workflow runs response for octocat\/hello-world must include a workflow_runs array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed repository names before GitHub API calls", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["bad owner/repo"]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects repository names with surrounding whitespace before GitHub API calls", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns([" octocat/hello-world "]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed repository names before requiring a GitHub token for failed workflows", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["bad owner/repo"]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects repository names with control characters without echoing them", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        async () => {
          try {
            await listFailedWorkflowRuns(["octocat/\thello-world"]);
          } catch (error) {
            assert.ok(error instanceof Error);
            assert.match(error.message, /GitHub repository must be in owner\/repo form/);
            assert.doesNotMatch(error.message, /\t/);
            throw error;
          }
        },
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects repository names with surrounding whitespace before requiring a GitHub token for security alerts", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts([" octocat/hello-world "]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("accepts dotted GitHub repository names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello..world/actions/runs?status=failure&per_page=1");
      return new Response(JSON.stringify({ workflow_runs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      assert.deepEqual(
        await listFailedWorkflowRuns(["octocat/hello..world"], { maxPerRepo: 1 }),
        [],
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow links for a different repository", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "fix bug",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/other/actions/runs/123",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /must link to octocat\/hello-world/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow response entries with invalid run ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "wrong run link",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/456",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /must link to workflow run 123/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow links that are not workflow run links", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "fix bug",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /must link to a GitHub Actions workflow run/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow links with duplicate path separators", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "fix bug",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat//hello-world/actions/runs/123",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /must include a GitHub owner\/repo path/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow links with dot path segments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "fix bug",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/%2E/hello-world/actions/runs/123",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /must include a GitHub owner\/repo path/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow links with non-positive run IDs", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 0,
              name: "CI",
              display_title: "bad id",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/0",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /must contain workflow run objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow links that include credentials", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "fix bug",
              status: "completed",
              conclusion: "failure",
              html_url: "https://viewer@github.com/octocat/hello-world/actions/runs/123",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /must not include credentials/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow links that include ports", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "fix bug",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com:8443/octocat/hello-world/actions/runs/123",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /must not include a port/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects failed workflow links with query strings", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=5");

      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 123,
              name: "CI",
              display_title: "fix bug",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/octocat/hello-world/actions/runs/123?check_suite_focus=true",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () => listFailedWorkflowRuns(["octocat/hello-world"]),
        /must not include query strings or fragments/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts missing alert numbers", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing", severity: "high", summary: "Missing number" },
            dependency: { package: { name: "pkg-missing" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/1",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts missing html_url", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 7,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing-url", severity: "high", summary: "Missing URL" },
            dependency: { package: { name: "pkg-missing-url" } },
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot alerts with invalid alert numbers", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 1.5,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-bad-number", severity: "high", summary: "Bad number" },
            dependency: { package: { name: "pkg-bad-number" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/1",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must contain alert objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alert links that do not match the alert number", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 7,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-wrong", severity: "high", summary: "Wrong number" },
            dependency: { package: { name: "pkg-wrong" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/8",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must link to Dependabot alert 7/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts missing package names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 7,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing-pkg", severity: "high", summary: "Missing package" },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/7",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 7 for octocat\/hello-world missing package name/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with non-string package names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 7,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-bad-pkg", severity: "high", summary: "Bad package" },
            dependency: { package: { name: 123 } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/7",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 7 for octocat\/hello-world package name must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed Dependabot package names even when another package source is valid", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 7,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-bad-pkg", severity: "high", summary: "Bad package" },
            dependency: { package: { name: 123 } },
            security_vulnerability: { package: { name: "valid-package" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/7",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 7 for octocat\/hello-world package name must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with surrounding whitespace in package names", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 7,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-padded-pkg", severity: "high", summary: "Padded package" },
            dependency: { package: { name: " pkg-with-space " } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/7",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 7 for octocat\/hello-world package name must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts missing severities", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing-severity", summary: "Missing severity" },
            dependency: { package: { name: "pkg-missing-severity" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/8",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 8 for octocat\/hello-world missing severity/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with non-string severities", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-bad-severity", severity: 123, summary: "Bad severity" },
            dependency: { package: { name: "pkg-bad-severity" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/8",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 8 for octocat\/hello-world severity must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed Dependabot severities even when another severity source is valid", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-bad-severity", severity: "high", summary: "Bad severity" },
            security_vulnerability: { severity: 123 },
            dependency: { package: { name: "pkg-bad-severity" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/8",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 8 for octocat\/hello-world severity must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with surrounding whitespace in severities", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-padded-severity", severity: " high ", summary: "Padded severity" },
            dependency: { package: { name: "pkg-padded-severity" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/8",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 8 for octocat\/hello-world severity must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with unknown severity values", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 8,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-unknown-severity", severity: "moderate", summary: "Unknown severity" },
            dependency: { package: { name: "pkg-unknown-severity" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/8",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 8 for octocat\/hello-world severity must be one of critical, high, medium, or low/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts missing GHSA ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 9,
            state: "open",
            security_advisory: { severity: "high", summary: "Missing GHSA" },
            dependency: { package: { name: "pkg-missing-ghsa" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/9",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 9 for octocat\/hello-world missing GHSA id/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with non-string GHSA ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 9,
            state: "open",
            security_advisory: { ghsa_id: 123, severity: "high", summary: "Bad GHSA" },
            dependency: { package: { name: "pkg-bad-ghsa" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/9",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 9 for octocat\/hello-world GHSA id must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with surrounding whitespace in GHSA ids", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 9,
            state: "open",
            security_advisory: { ghsa_id: " GHSA-padded-ghsa ", severity: "high", summary: "Padded GHSA" },
            dependency: { package: { name: "pkg-padded-ghsa" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/9",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 9 for octocat\/hello-world GHSA id must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts missing summaries", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 10,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-missing-summary", severity: "high" },
            dependency: { package: { name: "pkg-missing-summary" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/10",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 10 for octocat\/hello-world missing summary/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with non-string summaries", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 10,
            state: "open",
            security_advisory: {
              ghsa_id: "GHSA-bad-summary",
              severity: "high",
              summary: 123,
            },
            dependency: { package: { name: "pkg-bad-summary" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/10",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 10 for octocat\/hello-world summary must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with surrounding whitespace in summaries", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 10,
            state: "open",
            security_advisory: {
              ghsa_id: "GHSA-padded-summary",
              severity: "high",
              summary: " padded summary ",
            },
            dependency: { package: { name: "pkg-padded-summary" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/10",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 10 for octocat\/hello-world summary must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with surrounding whitespace in html_url", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 11,
            state: "open",
            security_advisory: {
              ghsa_id: "GHSA-padded-url",
              severity: "high",
              summary: "Padded alert URL",
            },
            dependency: { package: { name: "pkg-padded-url" } },
            html_url: " https://github.com/octocat/hello-world/security/dependabot/11 ",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /Dependabot alert 11 for octocat\/hello-world html_url must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with surrounding whitespace in optional text fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    const cases = [
      {
        alert: {
          number: 12,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-padded-vrange",
            severity: "high",
            summary: "Padded vulnerable range",
          },
          dependency: { package: { name: "pkg-padded-vrange" } },
          security_vulnerability: { vulnerable_version_range: " < 1.2.3 " },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/12",
        },
        pattern:
          /Dependabot alert 12 for octocat\/hello-world vulnerable version range must not include surrounding whitespace/,
      },
      {
        alert: {
          number: 13,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-padded-patched",
            severity: "high",
            summary: "Padded patched version",
          },
          dependency: { package: { name: "pkg-padded-patched" } },
          security_vulnerability: { first_patched_version: { identifier: " 1.2.3 " } },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/13",
        },
        pattern:
          /Dependabot alert 13 for octocat\/hello-world patched version must not include surrounding whitespace/,
      },
      {
        alert: {
          number: 14,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-padded-manifest",
            severity: "high",
            summary: "Padded manifest path",
          },
          dependency: {
            package: { name: "pkg-padded-manifest" },
            manifest_path: " package-lock.json ",
          },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/14",
        },
        pattern:
          /Dependabot alert 14 for octocat\/hello-world manifest path must not include surrounding whitespace/,
      },
    ] as const;

    try {
      for (const { alert, pattern } of cases) {
        global.fetch = async (input: URL | Request | string) => {
          const url = typeof input === "string" ? input : input.toString();
          assert.equal(url, firstURL);

          return new Response(JSON.stringify([alert]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        };

        await assert.rejects(
          () => listSecurityAlerts(["octocat/hello-world"]),
          pattern,
        );
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with non-string optional text fields", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    const cases = [
      {
        alert: {
          number: 12,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-vrange",
            severity: "high",
            summary: "Bad vulnerable range",
          },
          dependency: { package: { name: "pkg-bad-vrange" } },
          security_vulnerability: { vulnerable_version_range: 123 },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/12",
        },
        pattern:
          /Dependabot alert 12 for octocat\/hello-world vulnerable version range must be a string/,
      },
      {
        alert: {
          number: 13,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-patched",
            severity: "high",
            summary: "Bad patched version",
          },
          dependency: { package: { name: "pkg-bad-patched" } },
          security_vulnerability: { first_patched_version: { identifier: 123 } },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/13",
        },
        pattern:
          /Dependabot alert 13 for octocat\/hello-world patched version must be a string/,
      },
      {
        alert: {
          number: 14,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-manifest",
            severity: "high",
            summary: "Bad manifest path",
          },
          dependency: {
            package: { name: "pkg-bad-manifest" },
            manifest_path: 123,
          },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/14",
        },
        pattern:
          /Dependabot alert 14 for octocat\/hello-world manifest path must be a string/,
      },
    ] as const;

    try {
      for (const { alert, pattern } of cases) {
        global.fetch = async (input: URL | Request | string) => {
          const url = typeof input === "string" ? input : input.toString();
          assert.equal(url, firstURL);

          return new Response(JSON.stringify([alert]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        };

        await assert.rejects(
          () => listSecurityAlerts(["octocat/hello-world"]),
          pattern,
        );
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts with non-object nested optional records", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    const cases = [
      {
        alert: {
          number: 15,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-dependency-package",
            severity: "high",
            summary: "Bad dependency package",
          },
          dependency: { package: 123 },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/15",
        },
        pattern:
          /Dependabot alert 15 for octocat\/hello-world dependency package must be an object/,
      },
      {
        alert: {
          number: 16,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-vulnerability-package",
            severity: "high",
            summary: "Bad vulnerability package",
          },
          security_vulnerability: { package: 123 },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/16",
        },
        pattern:
          /Dependabot alert 16 for octocat\/hello-world vulnerability package must be an object/,
      },
      {
        alert: {
          number: 17,
          state: "open",
          security_advisory: {
            ghsa_id: "GHSA-bad-first-patched",
            severity: "high",
            summary: "Bad first patched version",
          },
          dependency: { package: { name: "pkg-bad-first-patched" } },
          security_vulnerability: { first_patched_version: 123 },
          html_url: "https://github.com/octocat/hello-world/security/dependabot/17",
        },
        pattern:
          /Dependabot alert 17 for octocat\/hello-world first patched version must be an object/,
      },
    ] as const;

    try {
      for (const { alert, pattern } of cases) {
        global.fetch = async (input: URL | Request | string) => {
          const url = typeof input === "string" ? input : input.toString();
          assert.equal(url, firstURL);

          return new Response(JSON.stringify([alert]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        };

        await assert.rejects(
          () => listSecurityAlerts(["octocat/hello-world"]),
          pattern,
        );
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("loads paginated Dependabot alerts and sorts highest severity first", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    const secondURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100&page=2";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      if (url === firstURL) {
        return new Response(
          JSON.stringify([
            {
              number: 1,
              state: "open",
              security_advisory: { ghsa_id: "GHSA-low", severity: "low", summary: "Low issue" },
              dependency: { package: { name: "pkg-low" } },
              html_url: "https://github.com/octocat/hello-world/security/dependabot/1",
            },
          ]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: `<${secondURL}>; rel="next"`,
            },
          },
        );
      }

      if (url === secondURL) {
        return new Response(
          JSON.stringify([
            {
              number: 2,
              state: "open",
              security_advisory: { ghsa_id: "GHSA-critical", severity: "critical", summary: "Critical issue" },
              dependency: { package: { name: "pkg-critical" } },
              html_url: "https://github.com/octocat/hello-world/security/dependabot/2",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected GitHub route: ${url}`);
    };

    try {
      const alerts = await listSecurityAlerts(["octocat/hello-world", "octocat/hello-world"]);
      assert.equal(alerts.length, 2);
      assert.equal(alerts[0]?.severity, "critical");
      assert.equal(alerts[0]?.url, "https://github.com/octocat/hello-world/security/dependabot/2");
      assert.equal(alerts[1]?.severity, "low");
      assert.equal(calls, 2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects empty non-final Dependabot alert pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100&page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts response for octocat\/hello-world returned an empty page before pagination finished/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alerts when pagination repeats the current URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 1,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-loop", severity: "high", summary: "Loop" },
            dependency: { package: { name: "pkg-loop" } },
            html_url: "https://github.com/octocat/hello-world/security/dependabot/1",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: `<${firstURL}>; rel="next"`,
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub Dependabot alerts pagination for octocat\/hello-world repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alert links that are not alert links", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 1,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-home", severity: "high", summary: "Home" },
            dependency: { package: { name: "pkg-home" } },
            html_url: "https://github.com/octocat/hello-world",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must link to a Dependabot alert/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Dependabot alert links with duplicate path separators", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            number: 1,
            state: "open",
            security_advisory: { ghsa_id: "GHSA-home", severity: "high", summary: "Home" },
            dependency: { package: { name: "pkg-home" } },
            html_url: "https://github.com/octocat//hello-world/security/dependabot/1",
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
        () => listSecurityAlerts(["octocat/hello-world"]),
        /must include a GitHub owner\/repo path/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed repository names before requiring a GitHub token for security alerts", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["bad owner/repo"]),
        /GitHub repository must be in owner\/repo form/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

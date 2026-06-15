import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { hasToken, listNotifications, listSecurityAlerts, resolveAuthenticatedLogin, saveToken } from "./github.ts";
import { resetCache, save } from "../credential-store.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 01", { concurrency: false }, () => {
  const context = support.setupGitHubCredentialsTest();

  test("uses persisted token when available", () => {
    saveToken("github-token-abc");
    assert.equal(hasToken(), true);
  });


  test("uses env token when store is empty", () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    assert.equal(hasToken(), true);
  });


  test("does not use env token when the persisted store is unreadable", async () => {
    fs.mkdirSync(path.dirname(path.join(context.testDir, "secrets.json")), { recursive: true });
    fs.writeFileSync(path.join(context.testDir, "secrets.json"), "not json", "utf-8");
    resetCache();
    process.env.GITHUB_TOKEN = "github-env-token";

    assert.equal(hasToken(), false);
    await assert.rejects(
      () => resolveAuthenticatedLogin(),
      /Credential store .* is not valid JSON/,
    );
  });


  test("returns false when the persisted store is unreadable and no env token is set", () => {
    fs.mkdirSync(path.dirname(path.join(context.testDir, "secrets.json")), { recursive: true });
    fs.writeFileSync(path.join(context.testDir, "secrets.json"), "not json", "utf-8");
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

});

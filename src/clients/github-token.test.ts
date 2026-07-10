import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { hasToken, resolveAuthenticatedLogin, saveToken } from "./github.ts";
import { resetCache, save } from "../credential-store.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import { jsonResponse, setupGitHubCredentialsTest } from "./github-credentials-test-support.ts";

describe("github token and authenticated login", { concurrency: false }, () => {
  const context = setupGitHubCredentialsTest();

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

      return jsonResponse({ login: "octocat" });
    };

    try {
      assert.equal(await resolveAuthenticatedLogin(), "octocat");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("reports authenticated login API failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => jsonResponse({ message: "Bad credentials" }, { status: 401 }), async () => {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub API HTTP 401: Bad credentials/,
      );
    });
  });

  test("escapes control characters in authenticated login fetch failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => {
      throw new Error("Bad\tcredentials\nretry");
    }, async () => {
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
    });
  });

  test("rejects blank authenticated login API error messages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => jsonResponse({ message: "   " }, { status: 401 }), async () => {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub API HTTP 401: GitHub API error response message must be non-empty text without surrounding whitespace or control characters/,
      );
    });
  });

  test("escapes control characters in raw authenticated login API error payloads", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(
      () => new Response("bad\tcredentials\nretry", {
        status: 401,
        headers: { "Content-Type": "text/plain" },
      }),
      async () => {
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
      },
    );
  });

  test("rejects malformed authenticated user responses clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => jsonResponse([]), async () => {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub authenticated user response must be an object/,
      );
    });
  });

  test("rejects authenticated user responses with surrounding whitespace in logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => jsonResponse({ login: " octocat " }), async () => {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub authenticated user response login must not include surrounding whitespace/,
      );
    });
  });

  test("rejects authenticated user responses with empty logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => jsonResponse({ login: "   " }), async () => {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub authenticated user response login must not be empty/,
      );
    });
  });

  test("rejects authenticated user responses with control characters in logins", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    await withMockFetch(() => jsonResponse({ login: "octo\tcat" }), async () => {
      await assert.rejects(
        () => resolveAuthenticatedLogin(),
        /GitHub authenticated user response login must not include control characters/,
      );
    });
  });
});

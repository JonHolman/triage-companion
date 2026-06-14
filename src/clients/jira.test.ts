import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { hasCredentials, listOpenTickets, saveCredentials } from "./jira.ts";
import { resetCache, save } from "../credential-store.ts";

function createResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let originalConfigDir: string | undefined;
let originalBaseURL: string | undefined;
let originalEmail: string | undefined;
let originalApiToken: string | undefined;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalBaseURL = process.env.JIRA_BASE_URL;
  originalEmail = process.env.JIRA_EMAIL;
  originalApiToken = process.env.JIRA_API_TOKEN;

  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-jira-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;

  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
  resetCache();
});

afterEach(() => {
  resetCache();

  if (originalConfigDir === undefined) {
    delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
  } else {
    process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
  }

  if (originalBaseURL === undefined) {
    delete process.env.JIRA_BASE_URL;
  } else {
    process.env.JIRA_BASE_URL = originalBaseURL;
  }

  if (originalEmail === undefined) {
    delete process.env.JIRA_EMAIL;
  } else {
    process.env.JIRA_EMAIL = originalEmail;
  }

  if (originalApiToken === undefined) {
    delete process.env.JIRA_API_TOKEN;
  } else {
    process.env.JIRA_API_TOKEN = originalApiToken;
  }

  fs.rmSync(testDir, { force: true, recursive: true });
});

describe("jira client", () => {
  test("reflects persisted credentials", () => {
    saveCredentials("https://example.atlassian.net", "dev@example.com", "token");
    assert.equal(hasCredentials(), true);
  });

  test("reflects credentials from environment", () => {
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    assert.equal(hasCredentials(), true);
  });

  test("returns false when the persisted store is unreadable and no env credentials are set", () => {
    const secretsPath = path.join(testDir, "secrets.json");
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, "not json", "utf-8");
    resetCache();

    assert.equal(hasCredentials(), false);
  });

  test("returns false when the Jira base URL environment override is invalid", () => {
    process.env.JIRA_BASE_URL = "http://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    assert.equal(hasCredentials(), false);
  });

  test("rejects blank Jira base URL environment overrides before API requests", async () => {
    process.env.JIRA_BASE_URL = "";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    await assert.rejects(
      () => listOpenTickets(),
      /Jira base URL is required/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects plain HTTP base URLs", () => {
    assert.throws(
      () => saveCredentials("http://example.atlassian.net", "dev@example.com", "token"),
      /Jira base URL must use https:\/\//,
    );
  });

  test("rejects base URLs that include credentials", () => {
    assert.throws(
      () => saveCredentials("https://user@example.atlassian.net", "dev@example.com", "token"),
      /Jira base URL must not include credentials/,
    );
  });

  test("rejects base URLs that include control characters", () => {
    assert.throws(
      () => saveCredentials("https://exa\tmple.atlassian.net", "dev@example.com", "token"),
      /Jira base URL must not include control characters/,
    );
  });

  test("rejects base URLs that include dot path segments", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net/%2E/", "dev@example.com", "token"),
      /Jira base URL must not include dot path segments/,
    );
  });

  test("rejects base URLs that include ports", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net:8443", "dev@example.com", "token"),
      /Jira base URL must not include a port/,
    );
  });

  test("rejects ticket URLs as base URLs", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net/browse/ABC-123", "dev@example.com", "token"),
      /Jira base URL must be the site root/,
    );
  });

  test("rejects empty email and token values", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "   ", "token"),
      /Jira email is required/,
    );
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "dev@example.com", "   "),
      /Jira API token is required/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects Jira credentials with surrounding whitespace", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", " dev@example.com ", "token"),
      /Jira email must not include surrounding whitespace/,
    );
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "dev@example.com", " jira-token "),
      /Jira API token must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects Jira credentials with control characters", async () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "dev\n@example.com", "token"),
      /Jira email must not include control characters/,
    );
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "dev@example.com", "tok\nen"),
      /Jira API token must not include control characters/,
    );

    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env\n@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    await assert.rejects(
      () => listOpenTickets(),
      /Jira email must not include control characters/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects Jira environment credentials with surrounding whitespace", async () => {
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = " dev@example.com ";
    process.env.JIRA_API_TOKEN = " env-token ";

    await assert.rejects(
      () => listOpenTickets(),
      /Jira email must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects stored Jira credentials with surrounding whitespace", async () => {
    save("Triage Companion-Jira", "base-url", " https://stored.atlassian.net ");
    save("Triage Companion-Jira", "email", " stored@example.com ");
    save("Triage Companion-Jira", "api-token", " stored-token ");

    await assert.rejects(
      () => listOpenTickets(),
      /Jira base URL must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects stored Jira email and token values with surrounding whitespace", async () => {
    save("Triage Companion-Jira", "base-url", "https://stored.atlassian.net");
    save("Triage Companion-Jira", "email", " stored@example.com ");
    save("Triage Companion-Jira", "api-token", " stored-token ");

    await assert.rejects(
      () => listOpenTickets(),
      /Jira email must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects stored blank Jira base URLs before API requests", async () => {
    save("Triage Companion-Jira", "base-url", "");
    save("Triage Companion-Jira", "email", "stored@example.com");
    save("Triage Companion-Jira", "api-token", "stored-token");

    await assert.rejects(
      () => listOpenTickets(),
      /Jira base URL is required/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects Jira environment base URLs with surrounding whitespace", async () => {
    process.env.JIRA_BASE_URL = " https://env.atlassian.net ";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    await assert.rejects(
      () => listOpenTickets(),
      /Jira base URL must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("uses environment Jira credentials before persisted settings", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    global.fetch = async (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = init?.headers as Record<string, string>;

      assert.equal(
        url,
        "https://env.atlassian.net/rest/api/3/search?jql=assignee+%3D+currentUser%28%29+AND+resolution+%3D+Unresolved+ORDER+BY+updated+DESC&fields=summary%2Cstatus%2Cpriority%2Cissuetype%2Creporter%2Cupdated%2Cresolution&startAt=0&maxResults=100",
      );
      assert.equal(
        headers.Authorization,
        `Basic ${Buffer.from("env@example.com:env-token").toString("base64")}`,
      );
      assert.equal(init?.redirect, "error");

      return createResponse({ issues: [], startAt: 0, maxResults: 100, total: 0 });
    };

    try {
      assert.deepEqual(await listOpenTickets(), []);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("accepts Jira issue keys with underscores from custom project key formats", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");
    const updated = "2026-06-13T12:34:56.000Z";

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "MY_EXAMPLE_PROJECT-123",
            fields: {
              summary: "Valid custom key",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
              updated,
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      const tickets = await listOpenTickets();
      assert.equal(tickets.length, 1);
      assert.equal(tickets[0]?.key, "MY_EXAMPLE_PROJECT-123");
      assert.equal(tickets[0]?.updatedAt?.toISOString(), updated);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("accepts Jira issue keys with single-character custom project keys", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");
    const updated = "2026-06-13T12:35:56.000Z";

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "A-123",
            fields: {
              summary: "Valid single-character key",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
              updated,
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      const tickets = await listOpenTickets();
      assert.equal(tickets.length, 1);
      assert.equal(tickets[0]?.key, "A-123");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("sorts Jira tickets by updated time descending even if the API returns them out of order", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");
    const olderUpdated = "2026-06-13T12:34:56.000Z";
    const newerUpdated = "2026-06-13T12:35:56.000Z";

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-1",
            fields: {
              summary: "Older ticket",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
              updated: olderUpdated,
            },
          },
          {
            key: "ABC-2",
            fields: {
              summary: "Newer ticket",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "In Progress",
              },
              priority: {
                name: "High",
              },
              updated: newerUpdated,
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 2,
      });

    try {
      const tickets = await listOpenTickets();
      assert.equal(tickets.length, 2);
      assert.equal(tickets[0]?.key, "ABC-2");
      assert.equal(tickets[1]?.key, "ABC-1");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira search responses missing issues arrays", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        startAt: 0,
        maxResults: 100,
        total: 0,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira search response must include an issues array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira search responses that are not objects", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () => createResponse(null);

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira search response must include an issues array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects invalid JSON Jira search responses clearly", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira search response must be valid JSON/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("escapes control characters in Jira fetch failures", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () => {
      throw new Error("bad\trequest\nretry");
    };

    try {
      await assert.rejects(
        () => listOpenTickets(),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /Could not load Jira search response: bad\\trequest, retry/);
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects blank Jira API error messages", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        errorMessage: "   ",
        errorMessages: ["   "],
      }, 500);

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API error \(500\): Jira API error response errorMessage must be non-empty text without surrounding whitespace or control characters/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed Jira API error messages even when another message source is valid", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        errorMessage: { message: "Bad request" },
        errorMessages: ["Bad request"],
      }, 500);

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API error \(500\): Jira API error response errorMessage must be non-empty text without surrounding whitespace or control characters/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed Jira API error message arrays", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        errorMessages: ["Bad request", "   "],
      }, 500);

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API error \(500\): Jira API error response errorMessages must contain non-empty text without surrounding whitespace or control characters/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("escapes control characters in raw Jira API error payloads", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      new Response("bad\trequest\nretry", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /Jira API error \(500\): bad\\trequest, retry/);
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("escapes C1 control characters in raw Jira API error payloads", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      new Response("bad\u009brequest", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /Jira API error \(500\): bad\\u009brequest/);
          assert.ok(!message.includes("\u009b"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects non-object Jira API error payloads", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      new Response("[\t\"bad request\"\t]", {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /Jira API error \(500\): Jira API error response must be a JSON object/);
          assert.ok(!message.includes("\t"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira search responses missing pagination numbers", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [],
        startAt: 0,
        maxResults: 100,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira search response must include valid pagination numbers/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira search responses with mismatched pagination starts", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [],
        startAt: 1,
        maxResults: 100,
        total: 0,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira search response pagination startAt did not match the requested page/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira search responses with more issues than the returned page size", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [{}, {}],
        startAt: 0,
        maxResults: 1,
        total: 2,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira search response issue count exceeded the returned page size/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira search responses with more issues than the reported total", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [{}, {}],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira search response issue count exceeded the reported total/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("follows Jira pagination using the number of returned issues", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");
    const seenStartAts: string[] = [];
    const firstUpdated = "2026-06-13T12:36:56.000Z";
    const secondUpdated = "2026-06-13T12:37:56.000Z";

    global.fetch = async (input: URL | Request | string) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      seenStartAts.push(url.searchParams.get("startAt") ?? "");

      if (seenStartAts.length === 1) {
        return createResponse({
          issues: [
            {
              key: "ABC-1",
              fields: {
                summary: "First page",
                issuetype: {
                  name: "Task",
                },
                status: {
                  name: "To Do",
                },
                priority: {
                  name: "Medium",
                },
                updated: firstUpdated,
              },
            },
          ],
          startAt: 0,
          maxResults: 100,
          total: 2,
        });
      }

      return createResponse({
        issues: [
          {
            key: "ABC-2",
            fields: {
              summary: "Second page",
              issuetype: {
                name: "Bug",
              },
              status: {
                name: "In Progress",
              },
              priority: {
                name: "High",
              },
              updated: secondUpdated,
            },
          },
        ],
        startAt: 1,
        maxResults: 100,
        total: 2,
      });
    };

    try {
      const tickets = await listOpenTickets();
      assert.deepEqual(seenStartAts, ["0", "1"]);
      assert.equal(tickets.length, 2);
      assert.equal(tickets[0]?.key, "ABC-2");
      assert.equal(tickets[1]?.key, "ABC-1");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira search response issue entries that are not objects", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [null],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira search response issues must be objects/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues without keys", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            fields: {
              summary: "Missing key",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response included an issue without a key/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with non-string keys", async () => {
    saveCredentials("https://example.atlassian.net", "dev@example.com", "token");
    const originalFetch = global.fetch;
    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: 123,
            fields: {
              summary: "Bad key type",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue key must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with empty-string keys as invalid", async () => {
    saveCredentials("https://example.atlassian.net", "dev@example.com", "token");
    const originalFetch = global.fetch;
    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "",
            fields: {
              summary: "Empty key",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response included an invalid issue key/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with non-object fields", async () => {
    saveCredentials("https://example.atlassian.net", "dev@example.com", "token");
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({
        startAt: 0,
        maxResults: 50,
        total: 1,
        issues: [
          {
            key: "cmdct_1-123",
            fields: [],
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue CMDCT_1-123 fields must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with invalid field value types", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: 123,
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues that are already resolved", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Resolved issue",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "Done",
              },
              priority: {
                name: "Medium",
              },
              resolution: {
                name: "Done",
              },
              updated: "2026-06-13T12:34:56.000Z",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 must be unresolved/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with malformed resolution fields", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Resolved issue",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "Done",
              },
              priority: {
                name: "Medium",
              },
              resolution: "Done",
              updated: "2026-06-13T12:34:56.000Z",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with malformed resolution objects", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Resolved issue",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "Done",
              },
              priority: {
                name: "Medium",
              },
              resolution: {},
              updated: "2026-06-13T12:34:56.000Z",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with malformed named field objects", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              issuetype: {
                name: "Task",
              },
              status: {},
              priority: {
                name: "Medium",
              },
              updated: "2026-06-13T12:38:56.000Z",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues missing summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              status: {
                name: "To Do",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with empty summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with surrounding whitespace in summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: " Valid summary ",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with control characters in summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid\nsummary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with C1 control characters in summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid\u009bsummary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues missing statuses", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Missing status",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with empty named field values", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with surrounding whitespace in named field values", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: " Task ",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues missing issue types", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Missing issue type",
              status: {
                name: "To Do",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues missing priorities", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Missing priority",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues missing updated timestamps", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Missing updated",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with invalid updated timestamps", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Broken updated timestamp",
              updated: "not-a-date",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 updated must be a valid date string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira updated timestamps with impossible calendar dates", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Broken updated timestamp",
              updated: "2026-02-31T12:00:00.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 updated must be a valid date string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with empty reporter fields", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
              reporter: {
                displayName: "",
                emailAddress: "reporter@example.com",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with reporter objects missing all reporter text fields", async () => {
    process.env.JIRA_BASE_URL = "https://example.atlassian.net";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "jira-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Broken reporter",
              issuetype: { name: "Bug" },
              status: { name: "Open" },
              priority: { name: "High" },
              updated: "2026-01-01T00:00:00.000Z",
              reporter: {},
            },
          },
        ],
        startAt: 0,
        maxResults: 50,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issues with surrounding whitespace in reporter fields", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
              reporter: {
                displayName: " Reporter ",
                emailAddress: "reporter@example.com",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed Jira issue keys", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC-123/../../bad",
            fields: {
              summary: "Bad key",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response included an invalid issue key/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Jira issue keys with control characters without echoing them", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      createResponse({
        issues: [
          {
            key: "ABC\t123",
            fields: {
              summary: "Bad key",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /Jira API response included an invalid issue key\./);
          assert.ok(!message.includes("\t"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

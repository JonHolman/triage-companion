import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { hasCredentials, listOpenTickets, saveCredentials } from "./jira.ts";
import { resetCache, save } from "../credential-store.ts";
import * as support from "./jira-test-support.ts";

describe("jira client 01", { concurrency: false }, () => {
  const context = support.setupJiraClientTest();

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
    const secretsPath = path.join(context.testDir, "secrets.json");
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

      return support.createResponse({ issues: [], startAt: 0, maxResults: 100, total: 0 });
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
      support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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

    global.fetch = async () => support.createResponse(null);

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

});

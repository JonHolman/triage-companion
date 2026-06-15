import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenTickets, saveCredentials } from "./jira.ts";
import * as support from "./jira-test-support.ts";

describe("jira client 02", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("rejects blank Jira API error messages", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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
        return support.createResponse({
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

      return support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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
      support.createResponse({
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

});

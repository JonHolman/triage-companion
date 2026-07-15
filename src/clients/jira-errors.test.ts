import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenTickets, saveCredentials } from "./jira.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./jira-test-support.ts";

describe("jira API errors", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("rejects blank Jira API error messages", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () =>
        support.createResponse(
          {
            errorMessage: "   ",
            errorMessages: ["   "],
          },
          500,
        ),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira API error \(500\): Jira API error response errorMessage must be non-empty text without surrounding whitespace or control characters/,
        );
      },
    );
  });

  test("rejects malformed Jira API error messages even when another message source is valid", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () =>
        support.createResponse(
          {
            errorMessage: { message: "Bad request" },
            errorMessages: ["Bad request"],
          },
          500,
        ),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira API error \(500\): Jira API error response errorMessage must be non-empty text without surrounding whitespace or control characters/,
        );
      },
    );
  });

  test("rejects malformed Jira API error message arrays", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () => support.createResponse({ errorMessages: ["Bad request", "   "] }, 500),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira API error \(500\): Jira API error response errorMessages must contain non-empty text without surrounding whitespace or control characters/,
        );
      },
    );
  });

  test("escapes control characters in raw Jira API error payloads", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () =>
        new Response("bad\trequest\nretry", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      async () => {
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
      },
    );
  });

  test("escapes C1 control characters in raw Jira API error payloads", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () =>
        new Response("bad\u009brequest", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(message, /Jira API error \(500\): bad\\u009brequest/);
            assert.ok(!message.includes("\u009b"));
            return true;
          },
        );
      },
    );
  });

  test("summarizes Jira HTML API errors without dumping the page", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () =>
        new Response(
          "<html><head><title>Unauthorized (401)</title></head><body><h1>Unauthorized</h1><p>Basic Authentication Failure</p></body></html>",
          {
            status: 401,
            headers: { "Content-Type": "text/html;charset=UTF-8" },
          },
        ),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(
              message,
              /Jira API error \(401\): Jira API returned HTML instead of JSON: Unauthorized \(401\)\./,
            );
            assert.ok(!message.includes("<html>"));
            assert.ok(!message.includes("Basic Authentication Failure"));
            return true;
          },
        );
      },
    );
  });

  test("rejects non-object Jira API error payloads", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () =>
        new Response("[\t\"bad request\"\t]", {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(message, /Jira API error \(500\): Jira API error response must be a JSON object/);
            assert.ok(!message.includes("\t"));
            return true;
          },
        );
      },
    );
  });

  test("escapes control characters in Jira fetch failures", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () => {
        throw new Error("bad\trequest\nretry");
      },
      async () => {
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
      },
    );
  });
});

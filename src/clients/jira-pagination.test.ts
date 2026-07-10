import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenTickets, saveCredentials } from "./jira.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./jira-test-support.ts";

const BASE_URL = "https://stored.atlassian.net";

function saveTestCredentials(): void {
  saveCredentials(BASE_URL, "stored@example.com", "stored-token");
}

describe("jira pagination", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("rejects Jira search responses missing issues arrays", async () => {
    saveTestCredentials();

    await withMockFetch(
      () => support.createResponse({ isLast: true }),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search response must include an issues array/,
        );
      },
    );
  });

  test("rejects Jira search responses that are not objects", async () => {
    saveTestCredentials();

    await withMockFetch(
      () => support.createResponse(null),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search response must include an issues array/,
        );
      },
    );
  });

  test("rejects invalid JSON Jira search responses clearly", async () => {
    saveTestCredentials();

    await withMockFetch(
      () =>
        new Response("{", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search response must be valid JSON/,
        );
      },
    );
  });

  test("rejects Jira search response issue entries that are not objects", async () => {
    saveTestCredentials();

    await withMockFetch(
      () => support.searchResponse([null]),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search response issues must be objects/,
        );
      },
    );
  });

  test("rejects Jira search responses reporting more pages without a nextPageToken", async () => {
    saveTestCredentials();

    await withMockFetch(
      () => support.searchResponse([support.searchIssue("ABC-1")], { isLast: false }),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search response reported more pages without a nextPageToken/,
        );
      },
    );
  });

  test("rejects Jira search responses with non-text nextPageToken values", async () => {
    saveTestCredentials();

    await withMockFetch(
      () => support.searchResponse([support.searchIssue("ABC-1")], { nextPageToken: 42 }),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search response nextPageToken must be non-empty text without surrounding whitespace or control characters/,
        );
      },
    );
  });

  test("rejects Jira search responses with blank nextPageToken values", async () => {
    saveTestCredentials();

    await withMockFetch(
      () => support.searchResponse([support.searchIssue("ABC-1")], { nextPageToken: "   " }),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search response nextPageToken must be non-empty text without surrounding whitespace or control characters/,
        );
      },
    );
  });

  test("rejects empty Jira search pages that still advertise a nextPageToken", async () => {
    saveTestCredentials();

    await withMockFetch(
      () => support.searchResponse([], { nextPageToken: "tok-1" }),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search response returned an empty page before pagination finished/,
        );
      },
    );
  });

  test("rejects Jira search pagination that repeats a previously fetched page token", async () => {
    saveTestCredentials();

    await withMockFetch(
      routeHandler(
        new Map([
          [
            support.searchURL(BASE_URL),
            () => support.searchResponse([support.searchIssue("ABC-1")], { nextPageToken: "tok-1" }),
          ],
          [
            support.searchURL(BASE_URL, "tok-1"),
            () => support.searchResponse([support.searchIssue("ABC-2")], { nextPageToken: "tok-1" }),
          ],
        ]),
      ),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search pagination repeated a previously fetched page/,
        );
      },
    );
  });

  test("rejects Jira search responses with more issues than the requested page size", async () => {
    saveTestCredentials();

    await withMockFetch(
      () => support.searchResponse(Array.from({ length: 101 }, () => ({}))),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira search response issue count exceeded the requested page size/,
        );
      },
    );
  });

  test("follows Jira pagination by sending nextPageToken on continuation requests", async () => {
    saveTestCredentials();

    await withMockFetch(
      routeHandler(
        new Map([
          [
            support.searchURL(BASE_URL),
            () =>
              support.searchResponse(
                [
                  support.searchIssue("ABC-1", {
                    summary: "First page",
                    updated: "2026-06-13T12:36:56.000Z",
                  }),
                ],
                { nextPageToken: "tok-1", isLast: false },
              ),
          ],
          [
            support.searchURL(BASE_URL, "tok-1"),
            () =>
              support.searchResponse(
                [
                  support.searchIssue("ABC-2", {
                    summary: "Second page",
                    issuetype: { name: "Bug" },
                    status: { name: "In Progress" },
                    priority: { name: "High" },
                    updated: "2026-06-13T12:37:56.000Z",
                  }),
                ],
                { isLast: true },
              ),
          ],
        ]),
      ),
      async () => {
        const tickets = await listOpenTickets();
        assert.equal(tickets.length, 2);
        assert.equal(tickets[0]?.key, "ABC-2");
        assert.equal(tickets[1]?.key, "ABC-1");
      },
    );
  });
});

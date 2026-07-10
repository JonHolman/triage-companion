import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenTickets, saveCredentials } from "./jira.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./jira-test-support.ts";

describe("jira tickets", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("accepts Jira issue keys with underscores from custom project key formats", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");
    const updated = "2026-06-13T12:34:56.000Z";

    await withMockFetch(
      () =>
        support.searchResponse([
          support.searchIssue("MY_EXAMPLE_PROJECT-123", { summary: "Valid custom key", updated }),
        ]),
      async () => {
        const tickets = await listOpenTickets();
        assert.equal(tickets.length, 1);
        assert.equal(tickets[0]?.key, "MY_EXAMPLE_PROJECT-123");
        assert.equal(tickets[0]?.updatedAt.toISOString(), updated);
      },
    );
  });

  test("accepts Jira issue keys with single-character custom project keys", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () => support.searchResponse([support.searchIssue("A-123", { summary: "Valid single-character key" })]),
      async () => {
        const tickets = await listOpenTickets();
        assert.equal(tickets.length, 1);
        assert.equal(tickets[0]?.key, "A-123");
      },
    );
  });

  test("accepts issues with null reporters from deleted accounts", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () => support.searchResponse([support.searchIssue("ABC-123", { reporter: null })]),
      async () => {
        const tickets = await listOpenTickets();
        assert.equal(tickets.length, 1);
        assert.equal(tickets[0]?.reporter, null);
      },
    );
  });

  test("accepts issues with null priorities from unconfigured priority fields", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () => support.searchResponse([support.searchIssue("ABC-123", { priority: null })]),
      async () => {
        const tickets = await listOpenTickets();
        assert.equal(tickets.length, 1);
        assert.equal(tickets[0]?.priority, null);
      },
    );
  });

  test("sorts Jira tickets by updated time descending even if the API returns them out of order", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () =>
        support.searchResponse([
          support.searchIssue("ABC-1", {
            summary: "Older ticket",
            updated: "2026-06-13T12:34:56.000Z",
          }),
          support.searchIssue("ABC-2", {
            summary: "Newer ticket",
            status: { name: "In Progress" },
            priority: { name: "High" },
            updated: "2026-06-13T12:35:56.000Z",
          }),
        ]),
      async () => {
        const tickets = await listOpenTickets();
        assert.equal(tickets.length, 2);
        assert.equal(tickets[0]?.key, "ABC-2");
        assert.equal(tickets[1]?.key, "ABC-1");
      },
    );
  });

  test("rejects Jira issues without keys", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () => support.searchResponse([{ fields: { summary: "Missing key" } }]),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira API response included an issue without a key/,
        );
      },
    );
  });

  test("rejects Jira issues with non-string keys", async () => {
    saveCredentials("https://example.atlassian.net", "dev@example.com", "token");

    await withMockFetch(
      () => support.searchResponse([{ key: 123, fields: { summary: "Bad key type" } }]),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira API response issue key must be a string/,
        );
      },
    );
  });

  test("rejects Jira issues with empty-string keys as invalid", async () => {
    saveCredentials("https://example.atlassian.net", "dev@example.com", "token");

    await withMockFetch(
      () => support.searchResponse([{ key: "", fields: { summary: "Empty key" } }]),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira API response included an invalid issue key/,
        );
      },
    );
  });

  test("rejects malformed Jira issue keys", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () => support.searchResponse([{ key: "ABC-123/../../bad", fields: { summary: "Bad key" } }]),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira API response included an invalid issue key/,
        );
      },
    );
  });

  test("rejects Jira issue keys with control characters without echoing them", async () => {
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    await withMockFetch(
      () => support.searchResponse([{ key: "ABC\t123", fields: { summary: "Bad key" } }]),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(message, /Jira API response included an invalid issue key\./);
            assert.ok(!message.includes("\t"));
            return true;
          },
        );
      },
    );
  });

  test("rejects Jira issues with non-object fields", async () => {
    saveCredentials("https://example.atlassian.net", "dev@example.com", "token");

    await withMockFetch(
      () => support.searchResponse([{ key: "cmdct_1-123", fields: [] }]),
      async () => {
        await assert.rejects(
          () => listOpenTickets(),
          /Jira API response issue CMDCT_1-123 fields must be an object/,
        );
      },
    );
  });
});

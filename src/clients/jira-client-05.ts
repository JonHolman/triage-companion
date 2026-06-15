import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenTickets, saveCredentials } from "./jira.ts";
import * as support from "./jira-test-support.ts";

describe("jira client 05", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("rejects Jira issue keys with control characters without echoing them", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
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

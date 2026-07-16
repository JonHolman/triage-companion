import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addComment,
  assignTicketToSprint,
  changeTicketStatus,
  createTicket,
} from "./jira-actions.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import { saveCredentials } from "./jira.ts";
import * as support from "./jira-test-support.ts";

const BASE_URL = "https://stored.atlassian.net";

function urlText(input: URL | Request | string): string {
  return typeof input === "string" ? input : input.toString();
}

function requestHeaders(init: RequestInit | undefined): Record<string, string> {
  return init?.headers as Record<string, string>;
}

function requestBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("request body must be a string.");
  }
  return JSON.parse(body);
}

describe("jira ticket actions", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("creates Cloud Jira tickets with Atlassian document descriptions", async () => {
    saveCredentials(BASE_URL, "stored@example.com", "stored-token");

    await withMockFetch(
      (input, init) => {
        assert.equal(urlText(input), support.issueURL(BASE_URL));
        assert.equal(init?.method, "POST");
        assert.equal(requestHeaders(init).Accept, "application/json");
        assert.deepEqual(requestBody(init), {
          fields: {
            project: { key: "TC" },
            issuetype: { name: "Bug" },
            summary: "Fix checkout retry",
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Retry should preserve cart state." }],
                },
              ],
            },
          },
        });

        return support.createResponse({ id: "10001", key: "TC-123" }, 201);
      },
      async () => {
        const ticket = await createTicket({
          projectKey: "tc",
          issueType: "Bug",
          summary: "Fix checkout retry",
          description: "Retry should preserve cart state.",
        });

        assert.deepEqual(ticket, {
          id: "10001",
          key: "TC-123",
          url: "https://stored.atlassian.net/browse/TC-123",
        });
      },
    );
  });

  test("adds Data Center Jira comments with string bodies", async () => {
    saveCredentials("https://jira.example.gov", "stored@example.com", "stored-token");

    await withMockFetch(
      (input, init) => {
        assert.equal(urlText(input), support.issueCommentURL("https://jira.example.gov", "TC-123", "2"));
        assert.equal(init?.method, "POST");
        assert.equal(requestHeaders(init).Authorization, "Bearer stored-token");
        assert.deepEqual(requestBody(init), { body: "Looks good." });

        return support.createResponse({ id: "10002" }, 201);
      },
      async () => {
        const result = await addComment("tc-123", "Looks good.");
        assert.deepEqual(result, { id: "10002", issueKey: "TC-123" });
      },
    );
  });

  test("assigns Jira tickets to sprints through the Jira Software endpoint", async () => {
    saveCredentials(BASE_URL, "stored@example.com", "stored-token");

    await withMockFetch(
      (input, init) => {
        assert.equal(urlText(input), support.sprintIssueURL(BASE_URL, "42"));
        assert.equal(init?.method, "POST");
        assert.deepEqual(requestBody(init), { issues: ["TC-123"] });

        return new Response(null, { status: 204 });
      },
      async () => {
        await assignTicketToSprint("tc-123", "42");
      },
    );
  });

  test("changes Jira ticket status by selecting a transition with the target status", async () => {
    saveCredentials(BASE_URL, "stored@example.com", "stored-token");
    const calls: string[] = [];

    await withMockFetch(
      (input, init) => {
        const url = urlText(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        assert.equal(url, support.issueTransitionsURL(BASE_URL, "TC-123"));

        if (init?.method === "POST") {
          assert.deepEqual(requestBody(init), { transition: { id: "31" } });
          return new Response(null, { status: 204 });
        }

        return support.createResponse({
          transitions: [
            { id: "11", name: "Start Progress", to: { name: "In Progress" } },
            { id: "31", name: "Resolve", to: { name: "Done" } },
          ],
        });
      },
      async () => {
        const result = await changeTicketStatus("tc-123", "done");

        assert.deepEqual(calls, [
          `GET ${support.issueTransitionsURL(BASE_URL, "TC-123")}`,
          `POST ${support.issueTransitionsURL(BASE_URL, "TC-123")}`,
        ]);
        assert.deepEqual(result, { issueKey: "TC-123", status: "Done" });
      },
    );
  });

  test("rejects unavailable Jira target statuses with available statuses", async () => {
    saveCredentials(BASE_URL, "stored@example.com", "stored-token");

    await withMockFetch(
      () =>
        support.createResponse({
          transitions: [{ id: "11", name: "Start Progress", to: { name: "In Progress" } }],
        }),
      async () => {
        await assert.rejects(
          () => changeTicketStatus("TC-123", "Done"),
          /No Jira transition to status Done is available for TC-123\. Available statuses: In Progress\./,
        );
      },
    );
  });

  test("rejects malformed Jira issue keys before making write requests", async () => {
    saveCredentials(BASE_URL, "stored@example.com", "stored-token");
    let calls = 0;

    await withMockFetch(
      () => {
        calls += 1;
        return support.createResponse({});
      },
      async () => {
        await assert.rejects(
          () => addComment("bad", "Looks good."),
          /Jira issue key must use project-key-number format/,
        );
      },
    );

    assert.equal(calls, 0);
  });
});

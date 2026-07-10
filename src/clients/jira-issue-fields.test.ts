import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenTickets, saveCredentials } from "./jira.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./jira-test-support.ts";

const invalidTopLevelValues =
  /Jira API response issue ABC-123 fields must include valid top-level values/;

async function rejectsIssueFields(
  fieldOverrides: Record<string, unknown>,
  pattern: RegExp = invalidTopLevelValues,
): Promise<void> {
  saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

  await withMockFetch(
    () => support.searchResponse([support.searchIssue("ABC-123", fieldOverrides)]),
    async () => {
      await assert.rejects(() => listOpenTickets(), pattern);
    },
  );
}

describe("jira issue fields", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("rejects Jira issues with invalid field value types", async () => {
    await rejectsIssueFields({ summary: 123 });
  });

  test("rejects Jira issues that are already resolved", async () => {
    await rejectsIssueFields(
      {
        summary: "Resolved issue",
        status: { name: "Done" },
        resolution: { name: "Done" },
      },
      /Jira API response issue ABC-123 must be unresolved/,
    );
  });

  test("rejects Jira issues with malformed resolution fields", async () => {
    await rejectsIssueFields({ status: { name: "Done" }, resolution: "Done" });
  });

  test("rejects Jira issues with malformed resolution objects", async () => {
    await rejectsIssueFields({ status: { name: "Done" }, resolution: {} });
  });

  test("rejects Jira issues with malformed named field objects", async () => {
    await rejectsIssueFields({ status: {} });
  });

  test("rejects Jira issues missing summaries", async () => {
    await rejectsIssueFields({ summary: undefined });
  });

  test("rejects Jira issues with empty summaries", async () => {
    await rejectsIssueFields({ summary: "" });
  });

  test("rejects Jira issues with surrounding whitespace in summaries", async () => {
    await rejectsIssueFields({ summary: " Valid summary " });
  });

  test("rejects Jira issues with control characters in summaries", async () => {
    await rejectsIssueFields({ summary: "Valid\nsummary" });
  });

  test("rejects Jira issues with C1 control characters in summaries", async () => {
    await rejectsIssueFields({ summary: "Valid\u009bsummary" });
  });

  test("rejects Jira issues missing statuses", async () => {
    await rejectsIssueFields({ status: undefined });
  });

  test("rejects Jira issues with empty named field values", async () => {
    await rejectsIssueFields({ issuetype: { name: "" } });
  });

  test("rejects Jira issues with surrounding whitespace in named field values", async () => {
    await rejectsIssueFields({ issuetype: { name: " Task " } });
  });

  test("rejects Jira issues missing issue types", async () => {
    await rejectsIssueFields({ issuetype: undefined });
  });

  test("rejects Jira issues missing priorities", async () => {
    await rejectsIssueFields({ priority: undefined });
  });

  test("rejects Jira issues missing updated timestamps", async () => {
    await rejectsIssueFields({ updated: undefined });
  });

  test("rejects Jira issues with invalid updated timestamps", async () => {
    await rejectsIssueFields(
      { updated: "not-a-date" },
      /Jira API response issue ABC-123 updated must be a valid date string/,
    );
  });

  test("rejects Jira updated timestamps with impossible calendar dates", async () => {
    await rejectsIssueFields(
      { updated: "2026-02-31T12:00:00.000Z" },
      /Jira API response issue ABC-123 updated must be a valid date string/,
    );
  });

  test("rejects Jira issues with empty reporter fields", async () => {
    await rejectsIssueFields({
      reporter: { displayName: "", emailAddress: "reporter@example.com" },
    });
  });

  test("rejects Jira issues with reporter objects missing all reporter text fields", async () => {
    await rejectsIssueFields({ reporter: {} });
  });

  test("rejects Jira issues with surrounding whitespace in reporter fields", async () => {
    await rejectsIssueFields({
      reporter: { displayName: " Reporter ", emailAddress: "reporter@example.com" },
    });
  });
});

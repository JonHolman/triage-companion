import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

async function expectIssueRejection(issue: unknown, expected: RegExp, severity?: string): Promise<void> {
  await support.withSnykRoutes(
    {
      projectsByOrg: { "org-1": [] },
      issuesByOrg: { "org-1": [issue] },
    },
    async () => {
      await assert.rejects(() => listOpenIssues(severity ? { severity } : {}), expected);
    },
  );
}

describe("snyk issue validation", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("rejects unsafe Snyk issue IDs before output", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ id: "../bad" }),
      /Snyk issue ID must be a safe API path segment/,
    );
  });

  test("rejects Snyk issues without IDs", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ id: undefined }),
      /Snyk API response included an issue without an id/,
    );
  });

  test("rejects Snyk issues with blank IDs", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ id: "" }),
      /Snyk issue ID must be a safe API path segment/,
    );
  });

  test("rejects Snyk issues without attributes objects", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection({ id: "issue-1" }, /Snyk issue issue-1 attributes must be an object/);
  });

  test("rejects Snyk issues missing status", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { status: undefined } }),
      /Snyk issue missing status: issue-1/,
    );
  });

  test("rejects Snyk issues with non-string statuses", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { status: 123 } }),
      /Snyk issue issue-1 status must be a string/,
    );
  });

  test("rejects Snyk issues with non-open statuses", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { status: "closed" } }),
      /Snyk issue issue-1 must have status open/,
    );
  });

  test("rejects Snyk issues with control characters in statuses", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { status: "op\ten" } }),
      /Snyk issue issue-1 status must not include control characters/,
    );
  });

  test("rejects Snyk issues that are still marked ignored", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { ignored: true } }),
      /Snyk issue issue-1 must not be ignored/,
    );
  });

  test("rejects Snyk issues missing the ignored attribute", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { ignored: undefined } }),
      /Snyk issue issue-1 ignored must be a boolean/,
    );
  });

  test("rejects Snyk issues with non-boolean ignored attributes", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { ignored: "false" } }),
      /Snyk issue issue-1 ignored must be a boolean/,
    );
  });

  test("rejects non-open Snyk issues before severity filtering can skip them", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { effective_severity_level: "low", status: "closed" } }),
      /Snyk issue issue-1 must have status open/,
      "high",
    );
  });

  test("rejects Snyk issues missing severity", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { effective_severity_level: undefined } }),
      /Snyk issue missing severity: issue-1/,
    );
  });

  test("rejects Snyk issues with non-string severity", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { effective_severity_level: 123 } }),
      /Snyk issue issue-1 effective_severity_level must be a string/,
    );
  });

  test("rejects malformed Snyk severity fields even when another severity source is valid", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { effective_severity_level: 123, severity: "high" } }),
      /Snyk issue issue-1 effective_severity_level must be a string/,
    );
  });

  test("rejects Snyk issues with whitespace-only severity", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { effective_severity_level: "   " } }),
      /Snyk issue issue-1 effective_severity_level must be a non-empty string/,
    );
  });

  test("rejects Snyk issues with surrounding whitespace in severity", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { effective_severity_level: " high " } }),
      /Snyk issue issue-1 effective_severity_level must not include surrounding whitespace/,
    );
  });

  test("rejects Snyk issues with unknown severity values", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { effective_severity_level: "info" } }),
      /Snyk issue issue-1 severity must be one of critical, high, medium, or low/,
    );
  });

  test("rejects Snyk issues with unknown severity values before applying severity filters", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectIssueRejection(
      support.snykIssue({ attributes: { effective_severity_level: "info" } }),
      /Snyk issue issue-1 severity must be one of critical, high, medium, or low/,
      "high",
    );
  });
});

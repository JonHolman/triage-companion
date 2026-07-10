import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

async function expectScanItemRejection(issue: unknown, expected: RegExp): Promise<void> {
  await support.withSnykRoutes(
    {
      projectsByOrg: { "org-1": [] },
      issuesByOrg: { "org-1": [issue] },
    },
    async () => {
      await assert.rejects(() => listOpenIssues(), expected);
    },
  );
}

describe("snyk scan item", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("rejects Snyk issues missing the relationships object", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({ relationships: undefined }),
      /Snyk issue issue-1 must include a scan_item relationship/,
    );
  });

  test("rejects Snyk issues missing the scan_item relationship", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({ relationships: {} }),
      /Snyk issue issue-1 must include a scan_item relationship/,
    );
  });

  test("rejects Snyk issue scan item relationships that are not objects", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({ relationships: { scan_item: "project-1" } }),
      /Snyk issue issue-1 scan_item relationship must be an object/,
    );
  });

  test("rejects Snyk issue scan item relationships whose data is not an object", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({ relationships: { scan_item: { data: "project-1" } } }),
      /Snyk issue issue-1 scan_item relationship data must be an object/,
    );
  });

  test("rejects malformed Snyk issue scan item relationship IDs", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({ id: "issue-bad-relationship", projectID: 123 }),
      /Snyk issue issue-bad-relationship scan_item relationship must include a project id/,
    );
  });

  test("rejects Snyk issue scan item relationships that omit the project id", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({ id: "issue-missing-project-id", projectID: undefined }),
      /Snyk issue issue-missing-project-id scan_item relationship must include a project id/,
    );
  });

  test("rejects Snyk issue scan item relationships with blank project ids", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({ id: "issue-blank-project-id", projectID: "" }),
      /Snyk project ID must be a safe API path segment/,
    );
  });

  test("rejects unsafe Snyk issue scan item project IDs", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({ id: "issue-unsafe-project", projectID: ".." }),
      /Snyk project ID must be a safe API path segment/,
    );
  });

  test("rejects Snyk issue scan item relationships with non-project types", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({
        id: "issue-bad-type",
        relationships: { scan_item: { data: { id: "project-1", type: "container" } } },
      }),
      /Snyk issue issue-bad-type scan_item relationship type must be project/,
    );
  });

  test("rejects Snyk issue scan item relationships that omit the project type", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({
        id: "issue-missing-project-type",
        relationships: { scan_item: { data: { id: "project-1" } } },
      }),
      /Snyk issue issue-missing-project-type scan_item relationship must include a type/,
    );
  });

  test("rejects empty Snyk issue scan item relationship data", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectScanItemRejection(
      support.snykIssue({
        id: "issue-empty-project-link",
        relationships: { scan_item: { data: {} } },
      }),
      /Snyk issue issue-empty-project-link scan_item relationship must include a type/,
    );
  });
});

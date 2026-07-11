import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk issues", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("rejects invalid severity filters before requiring a token", async () => {
    await assert.rejects(
      () => listOpenIssues({ severity: "bogus" }),
      /Snyk severity filter must be one of: critical, high, medium, low\./,
    );
  });

  test("rejects severity filters with surrounding whitespace before requiring a token", async () => {
    await assert.rejects(
      () => listOpenIssues({ severity: " high " }),
      /Snyk severity filter must not include surrounding whitespace\./,
    );
  });

  test("rejects empty severity filters before requiring a token", async () => {
    await assert.rejects(
      () => listOpenIssues({ severity: "" }),
      /Snyk severity filter must not be empty\./,
    );
  });

  test("loads open issues and sorts by severity and project", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: { "org-1": [support.webAppProject] },
        issuesByOrg: {
          "org-1": [
            support.snykIssue({
              id: "issue-low",
              attributes: {
                effective_severity_level: "low",
                title: "Minor bug",
                updated_at: "2025-01-02T00:00:00Z",
              },
            }),
            support.snykIssue({
              id: "issue-high",
              attributes: {
                effective_severity_level: "high",
                title: "Critical bug",
                updated_at: "2025-01-01T00:00:00Z",
              },
            }),
          ],
        },
      },
      async () => {
        const snapshot = await listOpenIssues();

        assert.equal(snapshot.issues.length, 2);
        assert.equal(snapshot.organizationCount, 1);
        assert.equal(snapshot.projectCount, 1);
        assert.equal(snapshot.issues[0]?.severity.toLowerCase(), "high");
        assert.equal(snapshot.issues[1]?.severity.toLowerCase(), "low");
        assert.equal(snapshot.issues[0]?.url, "https://app.snyk.io/org/acme/project/project-1#issue-issue-high");
        assert.equal(snapshot.issues[1]?.url, "https://app.snyk.io/org/acme/project/project-1#issue-issue-low");
        assert.equal(snapshot.issues[0]?.projectName, "web-app");
        assert.equal(snapshot.issues[0]?.packageName, null);
        assert.equal(snapshot.issues[0]?.introducedAt.toISOString(), "2025-01-01T00:00:00.000Z");
      },
    );
  });

  test("requests severity-filtered issues server-side and rejects out-of-filter rows", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: { "org-1": [] },
        issuesByOrg: {
          "org-1": [
            support.snykIssue({
              id: "issue-low",
              projectID: "ghost-project",
              attributes: { effective_severity_level: "low" },
            }),
          ],
        },
        severity: "high",
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues({ severity: "high" }),
          /Snyk issue issue-low must have severity high/,
        );
      },
    );
  });

  test("uses the projects listing name and ignores legacy project_name attributes", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: { "org-1": [support.webAppProject] },
        issuesByOrg: {
          "org-1": [support.snykIssue({ attributes: { project_name: "stale-name" } })],
        },
      },
      async () => {
        const snapshot = await listOpenIssues();
        assert.equal(snapshot.issues[0]?.projectName, "web-app");
      },
    );
  });

  test("rejects issues referencing unknown projects even when a legacy project_name attribute is present", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: { "org-1": [support.webAppProject] },
        issuesByOrg: {
          "org-1": [
            support.snykIssue({
              projectID: "project-9",
              attributes: { project_name: "orphan" },
            }),
          ],
        },
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk issue issue-1 references unknown project project-9/,
        );
      },
    );
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk projects", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("handles Snyk project IDs that match object prototype property names", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: { "org-1": [{ id: "__proto__", attributes: { name: "prototype-safe" } }] },
        issuesByOrg: { "org-1": [support.snykIssue({ id: "issue-proto", projectID: "__proto__" })] },
      },
      async () => {
        const snapshot = await listOpenIssues();
        assert.equal(snapshot.projectCount, 1);
        assert.equal(snapshot.issues[0]?.projectName, "prototype-safe");
      },
    );
  });

  test("rejects Snyk projects without IDs", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { projectsByOrg: { "org-1": [{ attributes: { name: "missing-id-project" } }] } },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk API response included a project without an id/,
        );
      },
    );
  });

  test("rejects Snyk projects with blank IDs", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { projectsByOrg: { "org-1": [{ id: "", attributes: { name: "blank-id-project" } }] } },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk project ID must be a safe API path segment/,
        );
      },
    );
  });

  test("rejects Snyk projects missing names", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { projectsByOrg: { "org-1": [{ id: "project-1", attributes: {} }] } },
      async () => {
        await assert.rejects(() => listOpenIssues(), /Snyk project missing name: project-1/);
      },
    );
  });

  test("rejects Snyk projects without attributes objects", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { projectsByOrg: { "org-1": [{ id: "project-1" }] } },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk project project-1 attributes must be an object/,
        );
      },
    );
  });

  test("rejects Snyk projects with whitespace-only names", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { projectsByOrg: { "org-1": [{ id: "project-1", attributes: { name: "   " } }] } },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk project project-1 name must be a non-empty string/,
        );
      },
    );
  });

  test("rejects Snyk projects with surrounding whitespace in names", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { projectsByOrg: { "org-1": [{ id: "project-1", attributes: { name: " web-app " } }] } },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk project project-1 name must not include surrounding whitespace/,
        );
      },
    );
  });

  test("rejects Snyk projects with control characters in names", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { projectsByOrg: { "org-1": [{ id: "project-1", attributes: { name: "web\napp" } }] } },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk project project-1 name must not include control characters/,
        );
      },
    );
  });

  test("rejects Snyk projects with non-string names", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { projectsByOrg: { "org-1": [{ id: "project-1", attributes: { name: 123 } }] } },
      async () => {
        await assert.rejects(() => listOpenIssues(), /Snyk project project-1 name must be a string/);
      },
    );
  });

  test("rejects unsafe Snyk project IDs before issue requests", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { projectsByOrg: { "org-1": [{ id: "..", attributes: { name: "web-app" } }] } },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk project ID must be a safe API path segment/,
        );
      },
    );
  });

  test("counts projects by project ID, not display name", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: {
          "org-1": [
            { id: "project-1", attributes: { name: "web-app" } },
            { id: "project-2", attributes: { name: "web-app" } },
          ],
        },
        issuesByOrg: {
          "org-1": [
            support.snykIssue({ id: "issue-1", projectID: "project-1" }),
            support.snykIssue({ id: "issue-2", projectID: "project-2" }),
          ],
        },
      },
      async () => {
        const snapshot = await listOpenIssues();
        assert.equal(snapshot.projectCount, 2);
      },
    );
  });

  test("rejects Snyk issues that reference projects missing from the project list", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: { "org-1": [] },
        issuesByOrg: { "org-1": [support.snykIssue()] },
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk issue issue-1 references unknown project project-1/,
        );
      },
    );
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk issue links", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("constructs app.snyk.io links from the org slug, project id, and issue key", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        orgs: [{ id: "org-1", attributes: { slug: "acme-corp", name: "Acme Corp" } }],
        projectsByOrg: { "org-1": [support.webAppProject] },
        issuesByOrg: { "org-1": [support.snykIssue()] },
      },
      async () => {
        const snapshot = await listOpenIssues();
        assert.equal(snapshot.issues[0]?.organizationSlug, "acme-corp");
        assert.equal(
          snapshot.issues[0]?.url,
          "https://app.snyk.io/org/acme-corp/project/project-1#issue-issue-1",
        );
      },
    );
  });

  test("constructs app.us.snyk.io links when using the US regional API base URL", async () => {
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.us.snyk.io/rest";

    await support.withSnykRoutes(
      {
        baseURL: "https://api.us.snyk.io/rest",
        projectsByOrg: { "org-1": [support.webAppProject] },
        issuesByOrg: { "org-1": [support.snykIssue({ id: "issue-us" })] },
      },
      async () => {
        const snapshot = await listOpenIssues();
        assert.equal(
          snapshot.issues[0]?.url,
          "https://app.us.snyk.io/org/acme/project/project-1#issue-issue-us",
        );
      },
    );
  });

  test("links each issue to its own project id", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: {
          "org-1": [
            { id: "project-1", attributes: { name: "web-app" } },
            { id: "project-2", attributes: { name: "api-service" } },
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
        const urls = snapshot.issues.map((issue) => issue.url).sort();
        assert.deepEqual(urls, [
          "https://app.snyk.io/org/acme/project/project-1#issue-issue-1",
          "https://app.snyk.io/org/acme/project/project-2#issue-issue-2",
        ]);
      },
    );
  });

  test("uses the issue key, not the issue id, in the link fragment", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: { "org-1": [support.webAppProject] },
        issuesByOrg: {
          "org-1": [support.snykIssue({ id: "issue-one", attributes: { key: "SNYK-KEY-9" } })],
        },
      },
      async () => {
        const snapshot = await listOpenIssues();
        assert.equal(snapshot.issues[0]?.issueKey, "SNYK-KEY-9");
        assert.equal(
          snapshot.issues[0]?.url,
          "https://app.snyk.io/org/acme/project/project-1#issue-SNYK-KEY-9",
        );
      },
    );
  });

  test("percent-encodes issue keys in link fragments", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        projectsByOrg: { "org-1": [support.webAppProject] },
        issuesByOrg: {
          "org-1": [support.snykIssue({ attributes: { key: "SNYK-JS lodash/1.0" } })],
        },
      },
      async () => {
        const snapshot = await listOpenIssues();
        assert.equal(
          snapshot.issues[0]?.url,
          "https://app.snyk.io/org/acme/project/project-1#issue-SNYK-JS%20lodash%2F1.0",
        );
      },
    );
  });

  test("constructs links when the organization slug is named project", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      {
        orgs: [{ id: "org-1", attributes: { slug: "project", name: "Project Org" } }],
        projectsByOrg: { "org-1": [support.webAppProject] },
        issuesByOrg: { "org-1": [support.snykIssue({ id: "issue-project-org" })] },
      },
      async () => {
        const snapshot = await listOpenIssues();
        assert.equal(
          snapshot.issues[0]?.url,
          "https://app.snyk.io/org/project/project/project-1#issue-issue-project-org",
        );
      },
    );
  });
});

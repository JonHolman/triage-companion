import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./snyk-test-support.ts";

const orgsURL = "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100";

describe("snyk orgs", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("rejects Snyk organizations without IDs", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { orgs: [{ attributes: { slug: "acme", name: "Acme" } }] },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk API response included an organization without an id/,
        );
      },
    );
  });

  test("rejects Snyk organizations with blank IDs", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { orgs: [{ id: "", attributes: { slug: "acme", name: "Acme" } }] },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk organization ID must be a safe API path segment/,
        );
      },
    );
  });

  test("rejects Snyk organizations missing slugs", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { orgs: [{ id: "org-1", attributes: { name: "Acme" } }] },
      async () => {
        await assert.rejects(() => listOpenIssues(), /Snyk organization missing slug: org-1/);
      },
    );
  });

  test("rejects Snyk organizations with non-string slugs", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { orgs: [{ id: "org-1", attributes: { slug: 123, name: "Acme" } }] },
      async () => {
        await assert.rejects(() => listOpenIssues(), /Snyk organization org-1 slug must be a string/);
      },
    );
  });

  test("rejects Snyk organizations with surrounding whitespace in slugs", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { orgs: [{ id: "org-1", attributes: { slug: " acme ", name: "Acme" } }] },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk organization org-1 slug must not include surrounding whitespace/,
        );
      },
    );
  });

  test("rejects Snyk organizations without attributes objects", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes({ orgs: [{ id: "org-1" }] }, async () => {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization org-1 attributes must be an object/,
      );
    });
  });

  test("rejects Snyk organizations missing names", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { orgs: [{ id: "org-1", attributes: { slug: "acme" } }] },
      async () => {
        await assert.rejects(() => listOpenIssues(), /Snyk organization missing name: org-1/);
      },
    );
  });

  test("rejects Snyk organizations with non-string names", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { orgs: [{ id: "org-1", attributes: { slug: "acme", name: 123 } }] },
      async () => {
        await assert.rejects(() => listOpenIssues(), /Snyk organization org-1 name must be a string/);
      },
    );
  });

  test("rejects Snyk organizations with control characters in names", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await support.withSnykRoutes(
      { orgs: [{ id: "org-1", attributes: { slug: "acme", name: "Acme\tOrg" } }] },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk organization org-1 name must not include control characters/,
        );
      },
    );
  });

  test("deduplicates organizations by ID before fetching projects and issues", async () => {
    process.env.SNYK_TOKEN = "token-123";
    let projectFetches = 0;
    let issueFetches = 0;

    await withMockFetch(
      (input) => {
        const url = input.toString();
        if (url === orgsURL) {
          return support.createResponse({
            data: [
              support.acmeOrg,
              { id: "org-1", attributes: { slug: "acme-duplicate", name: "Acme Duplicate" } },
            ],
          });
        }
        if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
          projectFetches++;
          return support.createResponse({ data: [support.webAppProject] });
        }
        if (url === "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100") {
          issueFetches++;
          return support.createResponse({ data: [support.snykIssue()] });
        }

        throw new Error(`Unexpected Snyk route: ${url}`);
      },
      async () => {
        const snapshot = await listOpenIssues();
        assert.equal(snapshot.organizationCount, 1);
        assert.equal(snapshot.issues.length, 1);
        assert.equal(projectFetches, 1);
        assert.equal(issueFetches, 1);
      },
    );
  });

  test("rejects unsafe Snyk organization IDs before follow-up requests", async () => {
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    await withMockFetch(
      (input) => {
        calls += 1;
        assert.equal(input.toString(), orgsURL);
        return support.createResponse({
          data: [{ id: "..", attributes: { slug: "acme", name: "Acme" } }],
        });
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk organization ID must be a safe API path segment/,
        );
        assert.equal(calls, 1);
      },
    );
  });

  test("rejects Snyk organization IDs with surrounding whitespace before follow-up requests", async () => {
    process.env.SNYK_TOKEN = "snyk-env-token";
    let calls = 0;

    await withMockFetch(
      () => {
        calls += 1;
        return support.createResponse({
          data: [{ id: " org-1 ", attributes: { slug: "safe-org", name: "Safe Org" } }],
        });
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk organization ID must not include surrounding whitespace/,
        );
        assert.equal(calls, 1);
      },
    );
  });

  test("rejects unsafe Snyk organization slugs before follow-up requests", async () => {
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    await withMockFetch(
      (input) => {
        calls += 1;
        assert.equal(input.toString(), orgsURL);
        return support.createResponse({
          data: [{ id: "org-1", attributes: { slug: "..", name: "Acme" } }],
        });
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk organization slug must be a safe API path segment/,
        );
        assert.equal(calls, 1);
      },
    );
  });

  test("rejects unsafe configured Snyk organization IDs before API requests", async () => {
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = "../bad";

    await withMockFetch(
      () => {
        throw new Error("unexpected network request");
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must be a safe API path segment/,
        );
      },
    );
  });

  test("rejects unsafe configured Snyk organization IDs before requiring a token", async () => {
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = "../bad";

    await withMockFetch(
      () => {
        throw new Error("unexpected network request");
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must be a safe API path segment/,
        );
      },
    );
  });

  test("rejects empty configured Snyk organization ID lists before API requests", async () => {
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = ",,,";

    await withMockFetch(
      () => {
        throw new Error("unexpected network request");
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must include at least one organization ID/,
        );
      },
    );
  });

  test("rejects blank configured Snyk organization ID entries before API requests", async () => {
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = "org-1,";

    await withMockFetch(
      () => {
        throw new Error("unexpected network request");
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must contain safe IDs separated by commas/,
        );
      },
    );
  });

  test("rejects configured Snyk organization IDs with surrounding whitespace before API requests", async () => {
    process.env.SNYK_TOKEN = "snyk-env-token";
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = "org-1, org-2";

    await assert.rejects(
      () => listOpenIssues(),
      /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must not include surrounding whitespace/,
    );
  });

  test("rejects configured Snyk organization IDs with outer surrounding whitespace before API requests", async () => {
    process.env.SNYK_TOKEN = "snyk-env-token";
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = " org-1,org-2 ";

    await assert.rejects(
      () => listOpenIssues(),
      /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must not include surrounding whitespace/,
    );
  });
});

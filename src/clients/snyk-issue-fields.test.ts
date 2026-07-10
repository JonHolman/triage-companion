import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

function routesFor(attributes: Record<string, unknown>): support.SnykRoutesConfig {
  return {
    projectsByOrg: { "org-1": [support.webAppProject] },
    issuesByOrg: { "org-1": [support.snykIssue({ attributes })] },
  };
}

async function expectAttributeRejection(
  attributes: Record<string, unknown>,
  expected: RegExp,
): Promise<void> {
  await support.withSnykRoutes(routesFor(attributes), async () => {
    await assert.rejects(() => listOpenIssues(), expected);
  });
}

describe("snyk issue fields", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("rejects Snyk issues missing type", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection({ type: undefined }, /Snyk issue missing type: issue-1/);
  });

  test("rejects Snyk issues with non-string types", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection({ type: 123 }, /Snyk issue issue-1 type must be a string/);
  });

  test("rejects Snyk issues with surrounding whitespace in types", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { type: " vuln " },
      /Snyk issue issue-1 type must not include surrounding whitespace/,
    );
  });

  test("rejects Snyk issues missing titles", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection({ title: undefined }, /Snyk issue missing title: issue-1/);
  });

  test("rejects Snyk issues with non-string titles", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection({ title: 123 }, /Snyk issue issue-1 title must be a string/);
  });

  test("rejects Snyk issues with whitespace-only titles", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { title: "   " },
      /Snyk issue issue-1 title must be a non-empty string/,
    );
  });

  test("rejects Snyk issues missing keys", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection({ key: undefined }, /Snyk issue missing key: issue-1/);
  });

  test("rejects Snyk issues with non-string issue keys", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection({ key: 123 }, /Snyk issue issue-1 key must be a string/);
  });

  test("rejects Snyk issues with surrounding whitespace in issue keys", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { key: " key-1 " },
      /Snyk issue issue-1 key must not include surrounding whitespace/,
    );
  });

  test("rejects Snyk issues missing created timestamps", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { created_at: undefined },
      /Snyk issue invalid introduced timestamp: issue-1/,
    );
  });

  test("rejects Snyk issues with invalid created timestamps", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { created_at: "not-a-date" },
      /Snyk issue invalid introduced timestamp: issue-1/,
    );
  });

  test("rejects Snyk issues with impossible created calendar dates", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { created_at: "2026-02-31T00:00:00Z" },
      /Snyk issue invalid introduced timestamp: issue-1/,
    );
  });

  test("rejects Snyk issues with non-string created timestamps", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { created_at: 123 },
      /Snyk issue issue-1 created_at must be a string/,
    );
  });

  test("rejects Snyk issues missing updated timestamps", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { updated_at: undefined },
      /Snyk issue invalid updated timestamp: issue-1/,
    );
  });

  test("rejects Snyk issues with invalid updated timestamps", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { updated_at: "not-a-date" },
      /Snyk issue invalid updated timestamp: issue-1/,
    );
  });

  test("rejects Snyk issues with non-ISO updated timestamps", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { updated_at: "1" },
      /Snyk issue invalid updated timestamp: issue-1/,
    );
  });

  test("rejects Snyk issues with non-string updated timestamps", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { updated_at: 123 },
      /Snyk issue issue-1 updated_at must be a string/,
    );
  });

  test("extracts package names from coordinates package representations", async () => {
    process.env.SNYK_TOKEN = "token-123";

    const coordinates = [
      {
        representations: [
          { resource_path: "/deployments/web" },
          { package: { name: "lodash", version: "4.17.20" } },
          { package: { name: "underscore", version: "1.0.0" } },
        ],
      },
    ];

    await support.withSnykRoutes(routesFor({ coordinates }), async () => {
      const snapshot = await listOpenIssues();
      assert.equal(snapshot.issues[0]?.packageName, "lodash");
    });
  });

  test("returns null package names for resource_path-only representations", async () => {
    process.env.SNYK_TOKEN = "token-123";

    const coordinates = [{ representations: [{ resource_path: "/deployments/web" }] }];

    await support.withSnykRoutes(routesFor({ coordinates }), async () => {
      const snapshot = await listOpenIssues();
      assert.equal(snapshot.issues[0]?.packageName, null);
    });
  });

  test("rejects Snyk issues with non-string coordinates package names", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { coordinates: [{ representations: [{ package: { name: 123 } }] }] },
      /Snyk issue issue-1 package name must be a string/,
    );
  });

  test("rejects Snyk issues whose coordinates are not an array", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { coordinates: {} },
      /Snyk issue issue-1 coordinates must be an array/,
    );
  });

  test("rejects Snyk issues whose coordinates entries are not objects", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { coordinates: ["bad"] },
      /Snyk issue issue-1 coordinates entries must be objects/,
    );
  });

  test("rejects Snyk issues whose coordinate representations are not an array", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { coordinates: [{}] },
      /Snyk issue issue-1 coordinate representations must be an array/,
    );
  });

  test("rejects Snyk issues whose coordinate representations entries are not objects", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectAttributeRejection(
      { coordinates: [{ representations: ["bad"] }] },
      /Snyk issue issue-1 coordinate representations entries must be objects/,
    );
  });
});

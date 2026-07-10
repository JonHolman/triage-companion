import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./snyk-test-support.ts";

const orgsURL = "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100";

async function expectPaginationRejection(next: unknown, expected: RegExp): Promise<void> {
  let calls = 0;

  await withMockFetch(
    (input) => {
      calls += 1;
      assert.equal(input.toString(), orgsURL);
      return support.createResponse({ data: [], links: { next } });
    },
    async () => {
      await assert.rejects(() => listOpenIssues(), expected);
      assert.equal(calls, 1);
    },
  );
}

describe("snyk pagination", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("follows base-relative Snyk pagination links to the next page", async () => {
    process.env.SNYK_TOKEN = "token-123";
    const secondOrg = { id: "org-2", attributes: { slug: "beta", name: "Beta" } };
    const nextPath = "/orgs?version=2024-10-15&limit=100&starting_after=cursor-1";
    const routes = support.snykRoutes({
      projectsByOrg: { "org-1": [], "org-2": [] },
      issuesByOrg: { "org-1": [], "org-2": [] },
    });
    routes.set(orgsURL, () =>
      support.createResponse({ data: [support.acmeOrg], links: { next: nextPath } }),
    );
    routes.set(`https://api.snyk.io/rest${nextPath}`, () =>
      support.createResponse({ data: [secondOrg] }),
    );

    await withMockFetch(routeHandler(routes), async () => {
      const snapshot = await listOpenIssues();
      assert.equal(snapshot.organizationCount, 2);
      assert.deepEqual(snapshot.issues, []);
    });
  });

  test("rejects non-US pagination links", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://api.eu.snyk.io/rest/orgs?version=2024-10-15&limit=100&page=2",
      /Snyk pagination link must stay on a US-hosted REST API base URL/,
    );
  });

  test("rejects Snyk pagination links that include credentials", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://reader@api.snyk.io/rest/orgs?version=2024-10-15&limit=100&page=2",
      /Snyk pagination link must not include credentials/,
    );
  });

  test("rejects Snyk pagination links that include ports", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://api.snyk.io:8443/rest/orgs?version=2024-10-15&limit=100&page=2",
      /Snyk pagination link must not include a port/,
    );
  });

  test("rejects invalid Snyk pagination links clearly", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection("https://%", /Snyk pagination link must be a valid URL/);
  });

  test("rejects Snyk pagination links with dot path segments", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://api.snyk.io/rest/./orgs?version=2024-10-15&limit=100&page=2",
      /Snyk pagination link must stay on the current API route/,
    );
  });

  test("rejects relative Snyk pagination links with dot path segments", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "./orgs?version=2024-10-15&limit=100&page=2",
      /Snyk pagination link must stay on the current API route/,
    );
  });

  test("rejects Snyk pagination links with surrounding whitespace", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      " https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100&page=2 ",
      /Snyk pagination link must be a valid URL/,
    );
  });

  test("rejects malformed Snyk pagination link objects instead of stopping pagination early", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection({ href: 2 }, /Snyk pagination link must be a valid URL/);
  });

  test("rejects Snyk pagination links that include fragments", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100&page=2#ignored",
      /Snyk pagination link must not include fragments/,
    );
  });

  test("rejects Snyk pagination links that change the API query", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100&include=projects&page=2",
      /Snyk pagination link must keep the current API query/,
    );
  });

  test("rejects Snyk pagination links outside the current route", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://api.snyk.io/rest/orgs/other/projects?version=2024-10-15&limit=100&page=2",
      /Snyk pagination link must stay on the current API route/,
    );
  });

  test("rejects Snyk pagination links without a REST API version", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://api.snyk.io/rest/orgs",
      /Snyk pagination link must include a REST API version/,
    );
  });

  test("rejects Snyk pagination links with a different REST API version", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://api.snyk.io/rest/orgs?version=2023-01-01&limit=100&page=2",
      /Snyk pagination link must keep the current REST API version/,
    );
  });

  test("rejects empty non-final Snyk pages", async () => {
    process.env.SNYK_TOKEN = "token-123";
    await expectPaginationRejection(
      "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100&starting_after=cursor-1",
      /Snyk API response returned an empty page before pagination finished/,
    );
  });

  test("rejects non-object Snyk links payloads instead of stopping pagination early", async () => {
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    await withMockFetch(
      (input) => {
        calls += 1;
        assert.equal(input.toString(), orgsURL);
        return support.createResponse({ data: [], links: 123 });
      },
      async () => {
        await assert.rejects(() => listOpenIssues(), /Snyk API response links must be an object/);
        assert.equal(calls, 1);
      },
    );
  });

  test("rejects Snyk pagination when it repeats the current URL", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      (input) => {
        assert.equal(input.toString(), orgsURL);
        return support.createResponse({
          data: [support.acmeOrg],
          links: { next: orgsURL },
        });
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk pagination link repeated a previously fetched page/,
        );
      },
    );
  });

  test("rejects Snyk pagination when it repeats the current URL with reordered query params", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      (input) => {
        assert.equal(input.toString(), orgsURL);
        return support.createResponse({
          data: [support.acmeOrg],
          links: { next: "https://api.snyk.io/rest/orgs?limit=100&version=2024-10-15" },
        });
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk pagination link repeated a previously fetched page/,
        );
      },
    );
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk client 04", { concurrency: false }, () => {
  support.setupSnykClientTest();

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


  test("rejects unsafe Snyk organization IDs before follow-up requests", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return support.createResponse({
        data: [
          { id: "..", attributes: { slug: "acme", name: "Acme" } },
        ],
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization ID must be a safe API path segment/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk organization IDs with surrounding whitespace before follow-up requests", async () => {
    process.env.SNYK_TOKEN = "snyk-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async () => {
      calls += 1;
      return support.createResponse({
        data: [
          {
            id: " org-1 ",
            attributes: {
              slug: "safe-org",
              name: "Safe Org",
            },
          },
        ],
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization ID must not include surrounding whitespace/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects unsafe Snyk organization slugs before follow-up requests", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return support.createResponse({
        data: [
          { id: "org-1", attributes: { slug: "..", name: "Acme" } },
        ],
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization slug must be a safe API path segment/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects unsafe Snyk project IDs before issue requests", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            { id: "..", attributes: { name: "web-app" } },
          ],
        }),
      ],
    ]);

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      const response = routes.get(url);
      if (!response) {
        throw new Error(`Unexpected Snyk route: ${url}`);
      }
      return response;
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk project ID must be a safe API path segment/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects unsafe Snyk issue IDs before output", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            {
              id: "../bad",
              attributes: {
                effective_severity_level: "high",
                title: "Unsafe issue",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1#issue-..%2Fbad",
              },
              relationships: { scan_item: { data: { id: "project-1", type: "project" } } },
            },
          ],
        }),
      ],
    ]);

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      const response = routes.get(url);
      if (!response) {
        throw new Error(`Unexpected Snyk route: ${url}`);
      }
      return response;
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk issue ID must be a safe API path segment/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues without IDs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        support.createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            {
              attributes: {
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
              },
            },
          ],
        }),
      ],
    ]);

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      const response = routes.get(url);
      if (!response) {
        throw new Error(`Unexpected Snyk route: ${url}`);
      }
      return response;
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API response included an issue without an id/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues with blank IDs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        support.createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            {
              id: "",
              attributes: {
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
              },
            },
          ],
        }),
      ],
    ]);

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      const response = routes.get(url);
      if (!response) {
        throw new Error(`Unexpected Snyk route: ${url}`);
      }
      return response;
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk issue ID must be a safe API path segment/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues without attributes objects", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        support.createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            {
              id: "issue-1",
            },
          ],
        }),
      ],
    ]);

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      const response = routes.get(url);
      if (!response) {
        throw new Error(`Unexpected Snyk route: ${url}`);
      }
      return response;
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk issue issue-1 attributes must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues missing status", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        support.createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Missing status",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
              },
            },
          ],
        }),
      ],
    ]);

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      const response = routes.get(url);
      if (!response) {
        throw new Error(`Unexpected Snyk route: ${url}`);
      }
      return response;
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk issue missing status: issue-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

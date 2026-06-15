import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk client 12", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("rejects Snyk issue links that include ports", async () => {
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
              id: "issue-port",
              attributes: {
                effective_severity_level: "high",
                title: "Port issue",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io:8443/org/acme/project/project-1#issue-issue-port",
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
        /Snyk issue URL must not include a port/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issue links that include query strings", async () => {
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
              id: "issue-query",
              attributes: {
                effective_severity_level: "high",
                title: "Query issue",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1?from=api#issue-issue-query",
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
        /Snyk issue URL must not include query strings/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("accepts Snyk issue links when org slug is named project", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "project", name: "Project Org" } },
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
              id: "issue-project-org",
              attributes: {
                effective_severity_level: "high",
                title: "Project org",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/project/project/project-1#issue-issue-project-org",
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
      const snapshot = await listOpenIssues();
      assert.equal(snapshot.issues[0]?.url, "https://app.snyk.io/org/project/project/project-1#issue-issue-project-org");
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed Snyk issue link paths clearly", async () => {
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
              id: "issue-bad-path",
              attributes: {
                effective_severity_level: "high",
                title: "Bad path",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/%E0%A4%A#issue-issue-bad-path",
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
        /Snyk issue URL must have a valid path/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects non-US pagination links", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return support.createResponse({
        data: [],
        links: {
          next: "https://api.eu.snyk.io/rest/orgs?version=2024-10-15&limit=100&page=2",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must stay on a US-hosted REST API base URL/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk pagination links that include credentials", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return support.createResponse({
        data: [],
        links: {
          next: "https://reader@api.snyk.io/rest/orgs?version=2024-10-15&limit=100&page=2",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must not include credentials/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects invalid Snyk pagination links clearly", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return support.createResponse({
        data: [],
        links: {
          next: "https://%",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must be a valid URL/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk pagination links with dot path segments", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return support.createResponse({
        data: [],
        links: {
          next: "https://api.snyk.io/rest/./orgs?version=2024-10-15&limit=100&page=2",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must stay on the current API route/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects relative Snyk pagination links with dot path segments", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return support.createResponse({
        data: [],
        links: {
          next: "./orgs?version=2024-10-15&limit=100&page=2",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must stay on the current API route/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk pagination links with surrounding whitespace", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return support.createResponse({
        data: [],
        links: {
          next: " https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100&page=2 ",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must be a valid URL/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

});

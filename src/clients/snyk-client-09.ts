import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk client 09", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("rejects malformed Snyk issue scan item relationship IDs", async () => {
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
              id: "issue-bad-relationship",
              attributes: {
                effective_severity_level: "high",
                title: "Bad relationship",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1#issue-issue-bad-relationship",
              },
              relationships: { scan_item: { data: { id: 123, type: "project" } } },
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
        /Snyk issue issue-bad-relationship scan_item relationship id must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issue scan item relationships with non-project types", async () => {
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
              id: "issue-bad-type",
              attributes: {
                url: "https://app.snyk.io/org/acme/issues#issue-issue-bad-type",
              },
              relationships: { scan_item: { data: { id: "project-1", type: "container" } } },
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
        /Snyk issue issue-bad-type scan_item relationship type must be project/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issue scan item relationships that omit the project id", async () => {
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
              id: "issue-missing-project-id",
              attributes: {
                url: "https://app.snyk.io/org/acme/issues#issue-issue-missing-project-id",
              },
              relationships: { scan_item: { data: { type: "project" } } },
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
        /Snyk issue issue-missing-project-id scan_item relationship must include a project id/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issue scan item relationships with blank project ids", async () => {
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
              id: "issue-blank-project-id",
              attributes: {
                url: "https://app.snyk.io/org/acme/issues#issue-issue-blank-project-id",
                severity: "high",
                status: "open",
                type: "package_vulnerability",
                title: "Blank project id",
              },
              relationships: { scan_item: { data: { id: "", type: "project" } } },
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
        /Snyk project ID must be a safe API path segment/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issue scan item relationships that omit the project type", async () => {
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
              id: "issue-missing-project-type",
              attributes: {
                url: "https://app.snyk.io/org/acme/project/project-1#issue-issue-missing-project-type",
              },
              relationships: { scan_item: { data: { id: "project-1" } } },
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
        /Snyk issue issue-missing-project-type scan_item relationship must include a type/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects empty Snyk issue scan item relationships", async () => {
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
              id: "issue-empty-project-link",
              attributes: {
                url: "https://app.snyk.io/org/acme/issues#issue-issue-empty-project-link",
              },
              relationships: { scan_item: { data: {} } },
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
        /Snyk issue issue-empty-project-link scan_item relationship must include an id and type/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects non-US Snyk issue links", async () => {
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
              id: "issue-eu",
              attributes: {
                effective_severity_level: "high",
                title: "Regional issue",
                status: "open",
                type: "vuln",
                url: "https://app.eu.snyk.io/org/acme/project/project-1#issue-issue-eu",
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
        /Snyk issue URL must be US-hosted/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

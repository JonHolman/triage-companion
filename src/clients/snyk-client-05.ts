import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk client 05", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("rejects Snyk issues with non-string statuses", async () => {
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
                title: "Bad status type",
                status: 123,
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
        /Snyk issue issue-1 status must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues with non-open statuses", async () => {
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
                title: "Closed issue",
                status: "closed",
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
        /Snyk issue issue-1 must have status open/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues that are still marked ignored", async () => {
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
                title: "Ignored issue",
                status: "open",
                ignored: true,
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
        /Snyk issue issue-1 must not be ignored/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects non-open Snyk issues before severity filtering can skip them", async () => {
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
                effective_severity_level: "low",
                title: "Closed issue",
                status: "closed",
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
        () => listOpenIssues({ severity: "high" }),
        /Snyk issue issue-1 must have status open/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues with non-string urls", async () => {
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
                title: "Bad url type",
                status: "open",
                type: "vuln",
                url: 123,
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
        /Snyk issue issue-1 url must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues with surrounding whitespace in urls", async () => {
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
                title: "Broken URL whitespace",
                status: "open",
                type: "vuln",
                url: " https://app.snyk.io/org/acme/issues#issue-issue-1 ",
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
        /Snyk issue issue-1 url must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues missing severity", async () => {
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
                title: "Missing severity",
                status: "open",
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
        /Snyk issue missing severity: issue-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk client 02", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("handles Snyk project IDs that match object prototype property names", async () => {
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
            { id: "__proto__", attributes: { name: "prototype-safe" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            {
              id: "issue-proto",
              attributes: {
                effective_severity_level: "high",
                title: "Prototype project",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/__proto__#issue-issue-proto",
              },
              relationships: { scan_item: { data: { id: "__proto__", type: "project" } } },
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
      assert.equal(snapshot.projectCount, 1);
      assert.equal(snapshot.issues[0]?.projectName, "prototype-safe");
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk projects without IDs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { attributes: { name: "missing-id-project" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API response included a project without an id/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk projects with blank IDs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "", attributes: { name: "blank-id-project" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
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


  test("rejects Snyk projects missing names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "project-1", attributes: {} },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk project missing name: project-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk projects without attributes objects", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "project-1" },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk project project-1 attributes must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk projects with whitespace-only names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "project-1", attributes: { name: "   " } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk project project-1 name must be a non-empty string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk projects with surrounding whitespace in names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "project-1", attributes: { name: " web-app " } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk project project-1 name must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk projects with control characters in names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "project-1", attributes: { name: "web\napp" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk project project-1 name must not include control characters/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk projects with non-string names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "project-1", attributes: { name: 123 } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk project project-1 name must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk organizations without IDs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API response included an organization without an id/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk organizations with blank IDs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization ID must be a safe API path segment/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk organizations missing slugs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { name: "Acme" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization missing slug: org-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

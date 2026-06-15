import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk client 01", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("reports missing token clearly", async () => {
    await assert.rejects(
      () => listOpenIssues(),
      (error) => {
        assert.ok(
          (error as Error).message.includes("Snyk token not configured"),
        );
        return true;
      },
    );
  });


  test("rejects invalid severity filters before requiring a token", async () => {
    await assert.rejects(
      () => listOpenIssues({ severity: "bogus" }),
      /Snyk severity filter must be one of: critical, high, medium, low\./,
    );
  });


  test("rejects severity filters with surrounding whitespace before requiring a token", async () => {
    await assert.rejects(
      () => listOpenIssues({ severity: " high " }),
      /Snyk severity filter must not include surrounding whitespace\./,
    );
  });


  test("rejects empty severity filters before requiring a token", async () => {
    await assert.rejects(
      () => listOpenIssues({ severity: "" }),
      /Snyk severity filter must not be empty\./,
    );
  });


  test("escapes control characters in raw Snyk API error payloads", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async () => new Response("bad\trequest\nretry", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });

    try {
      await assert.rejects(
        () => listOpenIssues(),
        (error) => {
          const message = (error as Error).message;
          assert.match(message, /Snyk API error \(500\): bad\\trequest, retry/);
          assert.equal(message.includes("\t"), false);
          assert.equal(message.includes("\n"), false);
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects blank structured Snyk API error messages", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async () => support.createResponse({
      errors: [
        { detail: "   " },
      ],
    }, 500);

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API error \(500\): Snyk API error response error detail must be a non-empty string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects non-object Snyk API error payloads", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async () => support.createResponse(["bad request"], 500);

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API error \(500\): Snyk API error response must be a JSON object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("escapes control characters in Snyk fetch failures", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async () => {
      throw new Error("bad\trequest\nretry");
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        (error) => {
          const message = (error as Error).message;
          assert.match(message, /Could not load Snyk API response: bad\\trequest, retry/);
          assert.equal(message.includes("\t"), false);
          assert.equal(message.includes("\n"), false);
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("loads open issues and sorts by severity and project", async () => {
    const originalFetch = global.fetch;
    const token = "token-123";

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
            {
              id: "project-1",
              attributes: { name: "web-app", target_reference: "target" },
            },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            {
              id: "issue-high",
              attributes: {
                effective_severity_level: "high",
                title: "Critical bug",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1#issue-issue-high",
                project_name: "web-app",
                updated_at: new Date("2025-01-01T00:00:00Z").toISOString(),
              },
              relationships: { scan_item: { data: { id: "project-1", type: "project" } } },
            },
            {
              id: "issue-low",
              attributes: {
                effective_severity_level: "low",
                title: "Minor bug",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1#issue-issue-low",
                project_name: "web-app",
                updated_at: new Date("2025-01-02T00:00:00Z").toISOString(),
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

    process.env.SNYK_TOKEN = token;
    const snapshot = await listOpenIssues();

    assert.equal(snapshot.issues.length, 2);
    assert.equal(snapshot.organizationCount, 1);
    assert.equal(snapshot.projectCount, 1);
    assert.equal(snapshot.issues[0]?.severity.toLowerCase(), "high");
    assert.equal(snapshot.issues[1]?.severity.toLowerCase(), "low");
    assert.equal(snapshot.issues[0]?.url, "https://app.snyk.io/org/acme/project/project-1#issue-issue-high");
    assert.equal(snapshot.issues[1]?.url, "https://app.snyk.io/org/acme/project/project-1#issue-issue-low");

    global.fetch = originalFetch;
  });


  test("counts projects by project ID, not display name", async () => {
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
            { id: "project-2", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        support.createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "First",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1#issue-issue-1",
              },
              relationships: { scan_item: { data: { id: "project-1", type: "project" } } },
            },
            {
              id: "issue-2",
              attributes: {
                effective_severity_level: "high",
                title: "Second",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-2#issue-issue-2",
              },
              relationships: { scan_item: { data: { id: "project-2", type: "project" } } },
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
      assert.equal(snapshot.projectCount, 2);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Snyk issues that reference projects missing from the project list", async () => {
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
                title: "Unknown project",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1#issue-issue-1",
                project_name: "web-app",
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
        /Snyk issue issue-1 references unknown project project-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("deduplicates organizations by ID before fetching projects and issues", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let projectFetches = 0;
    let issueFetches = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
            { id: "org-1", attributes: { slug: "acme-duplicate", name: "Acme Duplicate" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        projectFetches++;
        return support.createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100") {
        issueFetches++;
        return support.createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "First",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1#issue-issue-1",
              },
              relationships: { scan_item: { data: { id: "project-1", type: "project" } } },
            },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      const snapshot = await listOpenIssues();
      assert.equal(snapshot.organizationCount, 1);
      assert.equal(snapshot.issues.length, 1);
      assert.equal(projectFetches, 1);
      assert.equal(issueFetches, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { currentAPIBaseURL, hasToken, listOpenIssues, saveAPIBaseURL, saveToken } from "./snyk.ts";
import { resetCache, save } from "../credential-store.ts";

function createResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let originalConfigDir: string | undefined;
let originalToken: string | undefined;
let originalAPIBaseURL: string | undefined;
let originalOrganizationIDs: string | undefined;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalToken = process.env.SNYK_TOKEN;
  originalAPIBaseURL = process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
  originalOrganizationIDs = process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS;

  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-snyk-client-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  delete process.env.SNYK_TOKEN;
  delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
  delete process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS;

  resetCache();
});

afterEach(() => {
  resetCache();

  if (originalConfigDir === undefined) {
    delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
  } else {
    process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
  }

  if (originalToken === undefined) {
    delete process.env.SNYK_TOKEN;
  } else {
    process.env.SNYK_TOKEN = originalToken;
  }

  if (originalAPIBaseURL === undefined) {
    delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
  } else {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = originalAPIBaseURL;
  }

  if (originalOrganizationIDs === undefined) {
    delete process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS;
  } else {
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = originalOrganizationIDs;
  }

  fs.rmSync(testDir, { force: true, recursive: true });
});

describe("snyk client", () => {
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

    global.fetch = async () => createResponse({
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

    global.fetch = async () => createResponse(["bad request"], 500);

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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
            { id: "project-2", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
            { id: "org-1", attributes: { slug: "acme-duplicate", name: "Acme Duplicate" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        projectFetches++;
        return createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100") {
        issueFetches++;
        return createResponse({
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

  test("handles Snyk project IDs that match object prototype property names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "__proto__", attributes: { name: "prototype-safe" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({
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
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({
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
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({
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
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({
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
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({
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
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({
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
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({
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
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        });
      }
      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({
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
        return createResponse({
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
        return createResponse({
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
        return createResponse({
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

  test("rejects Snyk organizations with non-string slugs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: 123, name: "Acme" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization org-1 slug must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk organizations with surrounding whitespace in slugs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: " acme ", name: "Acme" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization org-1 slug must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk organizations without attributes objects", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return createResponse({
          data: [
            { id: "org-1" },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization org-1 attributes must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk organizations missing names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization missing name: org-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk organizations with non-string names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: 123 } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization org-1 name must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk organizations with control characters in names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme\tOrg" } },
          ],
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk organization org-1 name must not include control characters/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("hasToken uses stored credentials when present", () => {
    save("Triage Companion-Snyk", "token", "stored-token");
    assert.equal(hasToken(), true);
  });

  test("hasToken uses env token when store is empty", () => {
    process.env.SNYK_TOKEN = "env-token";
    assert.equal(hasToken(), true);
  });

  test("hasToken returns false when the persisted store is unreadable and no env token is set", () => {
    const secretsPath = path.join(testDir, "secrets.json");
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, "not json", "utf-8");
    resetCache();

    assert.equal(hasToken(), false);
  });

  test("hasToken returns false when the persisted store is unreadable even if env token is set", () => {
    const secretsPath = path.join(testDir, "secrets.json");
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, "not json", "utf-8");
    resetCache();
    process.env.SNYK_TOKEN = "env-token";

    assert.equal(hasToken(), false);
  });

  test("rejects empty token values", () => {
    assert.throws(() => saveToken("   "), /Snyk token is required/);
    assert.equal(hasToken(), false);
  });

  test("rejects saved Snyk tokens with surrounding whitespace", () => {
    assert.throws(() => saveToken(" snyk-token "), /Snyk token must not include surrounding whitespace/);
    assert.equal(hasToken(), false);
  });

  test("rejects Snyk tokens with control characters before API requests", async () => {
    process.env.SNYK_TOKEN = "token-\n123";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk token must not include control characters/,
    );
    assert.equal(hasToken(), false);
  });

  test("rejects Snyk tokens with surrounding whitespace before API requests", async () => {
    process.env.SNYK_TOKEN = " token-123 ";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk token must not include surrounding whitespace/,
    );
    assert.equal(hasToken(), false);
  });

  test("rejects stored Snyk tokens with surrounding whitespace before API requests", async () => {
    save("Triage Companion-Snyk", "token", " stored-token ");

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk token must not include surrounding whitespace/,
    );
    assert.equal(hasToken(), false);
  });

  test("rejects Snyk API base URLs with surrounding whitespace before requiring a token", async () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = " https://api.snyk.io/rest ";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk API base URL must not include surrounding whitespace/,
    );
  });

  test("rejects Snyk API base URLs with control characters before requiring a token", async () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.snyk.io/re\nst";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk API base URL must not include control characters/,
    );
  });

  test("rejects Snyk API base URLs with dot path segments before requiring a token", async () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.snyk.io/rest/%2E/";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk API base URL must not include dot path segments/,
    );
  });

  test("uses configured US regional API base URL", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.us.snyk.io/rest/";

    global.fetch = async (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.us.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      assert.equal(init?.redirect, "error");
      return createResponse({ data: [] });
    };

    try {
      const snapshot = await listOpenIssues();
      assert.equal(snapshot.organizationCount, 0);
      assert.equal(snapshot.issues.length, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk API responses missing data arrays", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({ links: {} });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API response must include a data array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk API responses that are not objects", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse(null);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API response must include a data array/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects invalid JSON Snyk API responses clearly", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/vnd.api+json" },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API response must be valid JSON/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk API response entries with invalid top-level fields", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({ data: [{ id: 123 }] });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API response data entries must be objects with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects unsafe configured Snyk organization IDs before API requests", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = "../bad";
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must be a safe API path segment/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects unsafe configured Snyk organization IDs before requiring a token", async () => {
    const originalFetch = global.fetch;
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = "../bad";
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must be a safe API path segment/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects empty configured Snyk organization ID lists before API requests", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = ",,,";
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must include at least one organization ID/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects blank configured Snyk organization ID entries before API requests", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = "org-1,";
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS must contain safe IDs separated by commas/,
      );
    } finally {
      global.fetch = originalFetch;
    }
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

  test("rejects unsafe Snyk organization IDs before follow-up requests", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({
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
      return createResponse({
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
      return createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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

  test("rejects Snyk issues with non-string statuses", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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

  test("rejects Snyk issues with non-string severity", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: 123,
                title: "Bad severity type",
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
        /Snyk issue issue-1 effective_severity_level must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed Snyk severity fields even when another severity source is valid", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: 123,
                severity: "high",
                title: "Bad severity type",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
                project_name: "web-app",
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
        /Snyk issue issue-1 effective_severity_level must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with whitespace-only severity", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "   ",
                title: "Blank severity",
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
        /Snyk issue issue-1 effective_severity_level must be a non-empty string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with surrounding whitespace in severity", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: " high ",
                title: "Spaced severity",
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
        /Snyk issue issue-1 effective_severity_level must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with unknown severity values", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "info",
                title: "Unknown severity",
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
        /Snyk issue issue-1 severity must be one of critical, high, medium, or low/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with unknown severity values before applying severity filters", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "info",
                title: "Unknown severity",
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
        () => listOpenIssues({ severity: "high" }),
        /Snyk issue issue-1 severity must be one of critical, high, medium, or low/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with control characters in statuses", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Broken status",
                status: "op\ten",
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
        /Snyk issue issue-1 status must not include control characters/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues missing type", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Missing type",
                status: "open",
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
        /Snyk issue missing type: issue-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with non-string types", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Bad type field",
                status: "open",
                type: 123,
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
        /Snyk issue issue-1 type must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with surrounding whitespace in types", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Padded type field",
                status: "open",
                type: " vuln ",
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
        /Snyk issue issue-1 type must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues missing titles", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
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
        /Snyk issue missing title: issue-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with non-string titles", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: 123,
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
        /Snyk issue issue-1 title must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with whitespace-only titles", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "   ",
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
        /Snyk issue issue-1 title must be a non-empty string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with invalid updated timestamps", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Broken timestamp",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
                updated_at: "not-a-date",
                project_name: "web-app",
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
        /Snyk issue invalid updated timestamp: issue-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with non-ISO updated timestamps", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Broken timestamp",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
                updated_at: "1",
                project_name: "web-app",
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
        /Snyk issue invalid updated timestamp: issue-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with non-string updated timestamps", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Broken timestamp type",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
                updated_at: 123,
                project_name: "web-app",
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
        /Snyk issue issue-1 updated_at must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with non-string package names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Broken package name",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
                updated_at: "2026-01-01T00:00:00Z",
                project_name: "web-app",
                package_name: 123,
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
        /Snyk issue issue-1 package_name must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with non-string issue keys", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Broken issue key",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
                project_name: "web-app",
                key: 123,
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
        /Snyk issue issue-1 key must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with invalid introduced timestamps", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Broken introduced timestamp",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
                introduced_date: "not-a-date",
                updated_at: "2026-01-01T00:00:00Z",
                project_name: "web-app",
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
        /Snyk issue invalid introduced timestamp: issue-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with impossible introduced calendar dates", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Broken introduced timestamp",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
                introduced_date: "2026-02-31T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
                project_name: "web-app",
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
        /Snyk issue invalid introduced timestamp: issue-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issues with non-string introduced timestamps", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-1",
              attributes: {
                effective_severity_level: "high",
                title: "Broken introduced timestamp type",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-1",
                introduced_date: 123,
                updated_at: "2026-01-01T00:00:00Z",
                project_name: "web-app",
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
        /Snyk issue issue-1 introduced_date must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects malformed Snyk issue scan item relationship IDs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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

  test("rejects Snyk issue links for a different project", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-wrong-project",
              attributes: {
                effective_severity_level: "high",
                title: "Wrong project",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-2#issue-issue-wrong-project",
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
        /Snyk issue URL must link to project project-1/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issue links outside the org project page", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-wrong-path",
              attributes: {
                effective_severity_level: "high",
                title: "Wrong path",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/group/acme/project/project-1#issue-issue-wrong-path",
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
        /Snyk issue URL must link to organization acme/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issue links with duplicate path separators", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-double-slash-path",
              attributes: {
                effective_severity_level: "high",
                title: "Duplicate separator",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme//project/project-1#issue-issue-double-slash-path",
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

  test("rejects Snyk issue links for a different organization slug", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-wrong-org",
              attributes: {
                effective_severity_level: "high",
                title: "Wrong org",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/other/project/project-1#issue-issue-wrong-org",
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
        /Snyk issue URL must link to organization acme/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issue links outside the organization when project is missing", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-no-project",
              attributes: {
                effective_severity_level: "high",
                title: "No project",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/other/issues#issue-issue-no-project",
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
        /Snyk issue URL must link to organization acme/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("accepts Snyk org issue links when project is missing", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-no-project",
              attributes: {
                effective_severity_level: "high",
                title: "No project",
                project_name: "org-level issue",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-no-project",
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
      const snapshot = await listOpenIssues();
      assert.equal(snapshot.issues[0]?.url, "https://app.snyk.io/org/acme/issues#issue-issue-no-project");
      assert.equal(snapshot.issues[0]?.projectID, null);
      assert.equal(snapshot.issues[0]?.projectName, "org-level issue");
      assert.equal(snapshot.projectCount, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk org issue links when project name is missing", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-no-project-name",
              attributes: {
                effective_severity_level: "high",
                title: "No project name",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-no-project-name",
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
        /Snyk issue missing project name: issue-no-project-name/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk org issue links with non-string project names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-no-project-name",
              attributes: {
                effective_severity_level: "high",
                title: "No project name",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-no-project-name",
                project_name: 123,
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
        /Snyk issue issue-no-project-name project_name must be a string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk org issue links with surrounding whitespace in project names", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-no-project-name",
              attributes: {
                effective_severity_level: "high",
                title: "No project name",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/issues#issue-issue-no-project-name",
                project_name: " org-level issue ",
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
        /Snyk issue issue-no-project-name project_name must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk project issue links when project is missing", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-no-project-link",
              attributes: {
                effective_severity_level: "high",
                title: "No project link",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1#issue-issue-no-project-link",
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
        /Snyk issue URL without a project relationship must link to organization issues page acme/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issue links with unsafe organization slugs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-unsafe-slug",
              attributes: {
                effective_severity_level: "high",
                title: "Unsafe slug",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/%2E%2E/project/project-1#issue-issue-unsafe-slug",
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
        /Snyk organization slug must be a safe API path segment/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects unsafe Snyk project IDs before accepting issue links", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({ data: [] }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-unsafe-project",
              attributes: {
                effective_severity_level: "high",
                title: "Unsafe project",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/%2E%2E#issue-issue-unsafe-project",
              },
              relationships: { scan_item: { data: { id: "..", type: "project" } } },
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

  test("rejects Snyk issue links for a different issue", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-one",
              attributes: {
                effective_severity_level: "high",
                title: "Wrong issue",
                status: "open",
                type: "vuln",
                url: "https://app.snyk.io/org/acme/project/project-1#issue-issue-two",
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
        /Snyk issue URL must link to issue issue-one/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issue links that include credentials", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
          data: [
            {
              id: "issue-credentialed",
              attributes: {
                effective_severity_level: "high",
                title: "Credentialed issue link",
                status: "open",
                type: "vuln",
                url: "https://viewer@app.snyk.io/org/acme/project/project-1#issue-issue-credentialed",
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
        /Snyk issue URL must not include credentials/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk issue links that include ports", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    const routes = new Map<string, Response>([
      [
        "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "project", name: "Project Org" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
        createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100",
        createResponse({
          data: [
            { id: "project-1", attributes: { name: "web-app" } },
          ],
        }),
      ],
      [
        "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100",
        createResponse({
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
      return createResponse({
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
      return createResponse({
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
      return createResponse({
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
      return createResponse({
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
      return createResponse({
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
      return createResponse({
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

  test("rejects malformed Snyk pagination link objects instead of stopping pagination early", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({
        data: [],
        links: {
          next: {
            href: 2,
          },
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

  test("rejects Snyk pagination links that include fragments", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({
        data: [],
        links: {
          next: "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100&page=2#ignored",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must not include fragments/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk pagination links that change the API query", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({
        data: [],
        links: {
          next: "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100&include=projects&page=2",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must keep the current API query/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk pagination links outside the current route", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({
        data: [],
        links: {
          next: "https://api.snyk.io/rest/orgs/other/projects?version=2024-10-15&limit=100&page=2",
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

  test("rejects Snyk pagination links without a REST API version", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({
        data: [],
        links: {
          next: "https://api.snyk.io/rest/orgs",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must include a REST API version/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk pagination links with a different REST API version", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({
        data: [],
        links: {
          next: "https://api.snyk.io/rest/orgs?version=2023-01-01&limit=100&page=2",
        },
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link must keep the current REST API version/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects non-object Snyk links payloads instead of stopping pagination early", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100");
      return createResponse({
        data: [],
        links: 123,
      });
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API response links must be an object/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk pagination when it repeats the current URL", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    const orgsURL = "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === orgsURL) {
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
          links: { next: orgsURL },
        });
      }

      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({ data: [] });
      }

      if (url === "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100") {
        return createResponse({ data: [] });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link repeated a previously fetched page/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects Snyk pagination when it repeats the current URL with reordered query params", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    const orgsURL = "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === orgsURL) {
        return createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
          links: {
            next: "https://api.snyk.io/rest/orgs?limit=100&version=2024-10-15",
          },
        });
      }

      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return createResponse({ data: [] });
      }

      if (url === "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100") {
        return createResponse({ data: [] });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk pagination link repeated a previously fetched page/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("rejects empty non-final Snyk pages", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";
    const orgsURL = "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === orgsURL) {
        return createResponse({
          data: [],
          links: {
            next: "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100&starting_after=cursor-1",
          },
        });
      }

      throw new Error(`Unexpected Snyk route: ${url}`);
    };

    try {
      await assert.rejects(
        () => listOpenIssues(),
        /Snyk API response returned an empty page before pagination finished/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("uses persisted US regional API base URL", () => {
    saveAPIBaseURL("https://api.us.snyk.io/rest/");
    assert.equal(currentAPIBaseURL(), "https://api.us.snyk.io/rest");
  });

  test("accepts mixed-case US regional API base URLs", () => {
    assert.equal(saveAPIBaseURL("https://API.US.SNYK.IO/rest/"), "https://api.us.snyk.io/rest");
  });

  test("rejects Snyk API base URLs that include credentials", () => {
    assert.throws(
      () => saveAPIBaseURL("https://user@api.snyk.io/rest"),
      /Snyk API base URL must not include credentials/,
    );
  });

  test("rejects Snyk API base URLs that include ports", () => {
    assert.throws(
      () => saveAPIBaseURL("https://api.snyk.io:8443/rest"),
      /Snyk API base URL must not include a port/,
    );
  });

  test("environment API base URL overrides persisted API base URL", () => {
    saveAPIBaseURL("https://api.snyk.io/rest");
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.us.snyk.io/rest/";

    assert.equal(currentAPIBaseURL(), "https://api.us.snyk.io/rest");
  });

  test("rejects unreadable persisted API base URL config instead of defaulting", () => {
    const configPath = path.join(testDir, "secrets.json");
    fs.writeFileSync(configPath, "not json", "utf-8");
    resetCache();

    assert.throws(() => currentAPIBaseURL(), /Credential store .* is not valid JSON/);
  });

  test("rejects invalid persisted API base URLs before requiring a token", async () => {
    save("Triage Companion-Config", "snyk-api-base-url", "https://api.eu.snyk.io/rest");

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk API base URL must be US-hosted/,
    );
  });

  test("saving API base URL returns the persisted value when env override is invalid", () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.eu.snyk.io/rest";

    assert.equal(saveAPIBaseURL("https://api.us.snyk.io/rest/"), "https://api.us.snyk.io/rest");
  });

  test("rejects non-US Snyk API base URL", async () => {
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.eu.snyk.io/rest";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk API base URL must be US-hosted/,
    );
  });

  test("rejects invalid Snyk API base URLs before requiring a token", async () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.eu.snyk.io/rest";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk API base URL must be US-hosted/,
    );
  });

  test("rejects Snyk Gov API base URL because token auth is unsupported", async () => {
    process.env.SNYK_TOKEN = "token-123";
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.snykgov.io/rest";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk Gov requires OAuth/,
    );
  });
});

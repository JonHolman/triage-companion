import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { hasToken, listOpenIssues, saveToken } from "./snyk.ts";
import { resetCache, save } from "../credential-store.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk client 03", { concurrency: false }, () => {
  const context = support.setupSnykClientTest();

  test("rejects Snyk organizations with non-string slugs", async () => {
    const originalFetch = global.fetch;
    process.env.SNYK_TOKEN = "token-123";

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100") {
        return support.createResponse({
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
        return support.createResponse({
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
        return support.createResponse({
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
        return support.createResponse({
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
        return support.createResponse({
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
        return support.createResponse({
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
    const secretsPath = path.join(context.testDir, "secrets.json");
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, "not json", "utf-8");
    resetCache();

    assert.equal(hasToken(), false);
  });


  test("hasToken returns false when the persisted store is unreadable even if env token is set", () => {
    const secretsPath = path.join(context.testDir, "secrets.json");
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
      return support.createResponse({ data: [] });
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
      return support.createResponse({ links: {} });
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
      return support.createResponse(null);
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
      return support.createResponse({ data: [{ id: 123 }] });
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

});

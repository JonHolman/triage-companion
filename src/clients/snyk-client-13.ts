import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { currentAPIBaseURL, listOpenIssues, saveAPIBaseURL } from "./snyk.ts";
import { resetCache, save } from "../credential-store.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk client 13", { concurrency: false }, () => {
  const context = support.setupSnykClientTest();

  test("rejects malformed Snyk pagination link objects instead of stopping pagination early", async () => {
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
      return support.createResponse({
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
      return support.createResponse({
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
      return support.createResponse({
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
      return support.createResponse({
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
      return support.createResponse({
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
      return support.createResponse({
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
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
          links: { next: orgsURL },
        });
      }

      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({ data: [] });
      }

      if (url === "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100") {
        return support.createResponse({ data: [] });
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
        return support.createResponse({
          data: [
            { id: "org-1", attributes: { slug: "acme", name: "Acme" } },
          ],
          links: {
            next: "https://api.snyk.io/rest/orgs?limit=100&version=2024-10-15",
          },
        });
      }

      if (url === "https://api.snyk.io/rest/orgs/org-1/projects?version=2024-10-15&limit=100") {
        return support.createResponse({ data: [] });
      }

      if (url === "https://api.snyk.io/rest/orgs/org-1/issues?status=open&ignored=false&version=2024-10-15&limit=100") {
        return support.createResponse({ data: [] });
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
        return support.createResponse({
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
    const configPath = path.join(context.testDir, "secrets.json");
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

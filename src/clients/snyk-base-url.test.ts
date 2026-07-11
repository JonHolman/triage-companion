import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { currentAPIBaseURL, listOpenIssues, saveAPIBaseURL } from "./snyk.ts";
import { resetCache, save } from "../credential-store.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk base url", { concurrency: false }, () => {
  const context = support.setupSnykClientTest();

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
      /Snyk API base URL must be one of the US REST API base URLs/,
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
      /Snyk API base URL must be one of the US REST API base URLs/,
    );
  });

  test("rejects invalid Snyk API base URLs before requiring a token", async () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.eu.snyk.io/rest";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk API base URL must be one of the US REST API base URLs/,
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

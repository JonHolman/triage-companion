import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { hasCredentials, listOpenTickets, saveCredentials } from "./jira.ts";
import { resetCache, save } from "../credential-store.ts";
import * as support from "./jira-test-support.ts";

describe("jira credentials", { concurrency: false }, () => {
  const context = support.setupJiraClientTest();

  test("reflects persisted credentials", () => {
    saveCredentials("https://example.atlassian.net", "dev@example.com", "token");
    assert.equal(hasCredentials(), true);
  });

  test("reflects credentials from environment", () => {
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    assert.equal(hasCredentials(), true);
  });

  test("returns false when the persisted store is unreadable and no env credentials are set", () => {
    const secretsPath = path.join(context.testDir, "secrets.json");
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, "not json", "utf-8");
    resetCache();

    assert.equal(hasCredentials(), false);
  });

  test("rejects empty email and token values", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "   ", "token"),
      /Jira email is required/,
    );
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "dev@example.com", "   "),
      /Jira API token is required/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects Jira credentials with surrounding whitespace", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", " dev@example.com ", "token"),
      /Jira email must not include surrounding whitespace/,
    );
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "dev@example.com", " jira-token "),
      /Jira API token must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects Jira credentials with control characters", async () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "dev\n@example.com", "token"),
      /Jira email must not include control characters/,
    );
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "dev@example.com", "tok\nen"),
      /Jira API token must not include control characters/,
    );

    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env\n@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    await assert.rejects(
      () => listOpenTickets(),
      /Jira email must not include control characters/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects invalid Jira Cloud IDs", async () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net", "dev@example.com", "token", "not-a-cloud-id"),
      /Jira Cloud ID must be an Atlassian Cloud ID UUID/,
    );

    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-token";
    process.env.JIRA_CLOUD_ID = "not-a-cloud-id";

    await assert.rejects(
      () => listOpenTickets(),
      /Jira Cloud ID must be an Atlassian Cloud ID UUID/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects Jira environment credentials with surrounding whitespace", async () => {
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = " dev@example.com ";
    process.env.JIRA_API_TOKEN = " env-token ";

    await assert.rejects(
      () => listOpenTickets(),
      /Jira email must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects stored Jira email and token values with surrounding whitespace", async () => {
    save("Triage Companion-Jira", "base-url", "https://stored.atlassian.net");
    save("Triage Companion-Jira", "email", " stored@example.com ");
    save("Triage Companion-Jira", "api-token", " stored-token ");

    await assert.rejects(
      () => listOpenTickets(),
      /Jira email must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("uses environment Jira credentials before persisted settings", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    global.fetch = async (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = init?.headers as Record<string, string>;

      assert.equal(url, support.searchURL("https://env.atlassian.net"));
      assert.equal(
        headers.Authorization,
        `Basic ${Buffer.from("env@example.com:env-token").toString("base64")}`,
      );
      assert.equal(init?.redirect, "error");

      return support.searchResponse([]);
    };

    try {
      assert.deepEqual(await listOpenTickets(), []);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("uses bearer token auth and Jira v2 search for Data Center base URLs", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://jira.example.gov", "stored@example.com", "stored-token");

    global.fetch = async (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = init?.headers as Record<string, string>;

      assert.equal(url, support.dataCenterSearchURL("https://jira.example.gov"));
      assert.equal(headers.Authorization, "Bearer stored-token");
      assert.equal(init?.redirect, "error");

      return support.createResponse({
        startAt: 0,
        maxResults: 100,
        total: 1,
        issues: [support.searchIssue("ABC-123")],
      });
    };

    try {
      const tickets = await listOpenTickets();
      assert.equal(tickets[0]?.url, "https://jira.example.gov/browse/ABC-123");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("uses the Atlassian scoped-token API route when a Cloud ID is configured", async () => {
    const originalFetch = global.fetch;
    saveCredentials(
      "https://stored.atlassian.net",
      "stored@example.com",
      "stored-token",
      "11111111-2222-3333-4444-555555555555",
    );

    global.fetch = async (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = init?.headers as Record<string, string>;

      assert.equal(
        url,
        support.searchURL("https://api.atlassian.com/ex/jira/11111111-2222-3333-4444-555555555555"),
      );
      assert.equal(
        headers.Authorization,
        `Basic ${Buffer.from("stored@example.com:stored-token").toString("base64")}`,
      );

      return support.searchResponse([support.searchIssue("ABC-123")]);
    };

    try {
      const tickets = await listOpenTickets();
      assert.equal(tickets[0]?.url, "https://stored.atlassian.net/browse/ABC-123");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

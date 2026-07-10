import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hasCredentials, listOpenTickets, saveCredentials } from "./jira.ts";
import { save } from "../credential-store.ts";
import * as support from "./jira-test-support.ts";

describe("jira base URL", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("returns false when the Jira base URL environment override is invalid", () => {
    process.env.JIRA_BASE_URL = "http://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    assert.equal(hasCredentials(), false);
  });

  test("rejects blank Jira base URL environment overrides before API requests", async () => {
    process.env.JIRA_BASE_URL = "";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    await assert.rejects(
      () => listOpenTickets(),
      /Jira base URL is required/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects plain HTTP base URLs", () => {
    assert.throws(
      () => saveCredentials("http://example.atlassian.net", "dev@example.com", "token"),
      /Jira base URL must use https:\/\//,
    );
  });

  test("rejects base URLs that include credentials", () => {
    assert.throws(
      () => saveCredentials("https://user@example.atlassian.net", "dev@example.com", "token"),
      /Jira base URL must not include credentials/,
    );
  });

  test("rejects base URLs that include control characters", () => {
    assert.throws(
      () => saveCredentials("https://exa\tmple.atlassian.net", "dev@example.com", "token"),
      /Jira base URL must not include control characters/,
    );
  });

  test("rejects base URLs that include dot path segments", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net/%2E/", "dev@example.com", "token"),
      /Jira base URL must not include dot path segments/,
    );
  });

  test("rejects base URLs that include ports", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net:8443", "dev@example.com", "token"),
      /Jira base URL must not include a port/,
    );
  });

  test("rejects ticket URLs as base URLs", () => {
    assert.throws(
      () => saveCredentials("https://example.atlassian.net/browse/ABC-123", "dev@example.com", "token"),
      /Jira base URL must be the site root/,
    );
  });

  test("rejects stored Jira base URLs with surrounding whitespace", async () => {
    save("Triage Companion-Jira", "base-url", " https://stored.atlassian.net ");
    save("Triage Companion-Jira", "email", " stored@example.com ");
    save("Triage Companion-Jira", "api-token", " stored-token ");

    await assert.rejects(
      () => listOpenTickets(),
      /Jira base URL must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects stored blank Jira base URLs before API requests", async () => {
    save("Triage Companion-Jira", "base-url", "");
    save("Triage Companion-Jira", "email", "stored@example.com");
    save("Triage Companion-Jira", "api-token", "stored-token");

    await assert.rejects(
      () => listOpenTickets(),
      /Jira base URL is required/,
    );
    assert.equal(hasCredentials(), false);
  });

  test("rejects Jira environment base URLs with surrounding whitespace", async () => {
    process.env.JIRA_BASE_URL = " https://env.atlassian.net ";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "env-token";

    await assert.rejects(
      () => listOpenTickets(),
      /Jira base URL must not include surrounding whitespace/,
    );
    assert.equal(hasCredentials(), false);
  });
});

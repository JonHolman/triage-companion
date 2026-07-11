import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

import { register } from "./jira.ts";
import { findCommand, optionLongNames, runRegisteredCommand } from "./command-test-support.ts";
import { hasCredentials, saveCredentials } from "../clients/jira.ts";
import { resetCache } from "../credential-store.ts";

let originalConfigDir: string | undefined;
let originalBaseURL: string | undefined;
let originalEmail: string | undefined;
let originalToken: string | undefined;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalBaseURL = process.env.JIRA_BASE_URL;
  originalEmail = process.env.JIRA_EMAIL;
  originalToken = process.env.JIRA_API_TOKEN;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-jira-command-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
  resetCache();
});

afterEach(() => {
  resetCache();
  if (originalConfigDir === undefined) {
    delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
  } else {
    process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
  }

  if (originalBaseURL === undefined) {
    delete process.env.JIRA_BASE_URL;
  } else {
    process.env.JIRA_BASE_URL = originalBaseURL;
  }

  if (originalEmail === undefined) {
    delete process.env.JIRA_EMAIL;
  } else {
    process.env.JIRA_EMAIL = originalEmail;
  }

  if (originalToken === undefined) {
    delete process.env.JIRA_API_TOKEN;
  } else {
    process.env.JIRA_API_TOKEN = originalToken;
  }

  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("jira command registration", () => {
  test("registers credentials and tickets commands", () => {
    const program = new Command();
    register(program);

    const jira = findCommand(program, "jira");
    assert.equal(jira.description(), "Jira tickets");

    const credentials = findCommand(jira, "credentials");
    assert.equal(credentials.description(), "Save Jira credentials");

    findCommand(jira, "remove-credentials");

    const tickets = findCommand(jira, "tickets");
    assert.deepEqual(optionLongNames(tickets), ["--json"]);
  });

  test("removes persisted credentials through the direct command", async () => {
    saveCredentials("https://example.atlassian.net", "dev@example.com", "secret-jira-token");
    assert.equal(hasCredentials(), true);

    const output = await runRegisteredCommand(register, ["jira", "remove-credentials"]);

    assert.equal(hasCredentials(), false);
    assert.match(output, /Jira credentials removed/);
    assert.equal(output.includes("secret-jira-token"), false);
  });

  test("remove-credentials reports environment credentials clearly", async () => {
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";
    saveCredentials("https://example.atlassian.net", "dev@example.com", "secret-jira-token");

    const output = await runRegisteredCommand(register, ["jira", "remove-credentials"]);

    assert.equal(hasCredentials(), true);
    assert.match(output, /Jira credentials removed/);
    assert.match(output, /JIRA_BASE_URL still provides the effective Jira base URL when set/);
    assert.match(output, /JIRA_EMAIL still provides the effective Jira email when set/);
    assert.match(output, /JIRA_API_TOKEN still provides the effective Jira API token when set/);
    assert.equal(output.includes("secret-jira-token"), false);
  });

  test("credentials reports environment overrides clearly", async () => {
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const output = await runRegisteredCommand(register, [
      "jira",
      "credentials",
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
    ]);

    assert.equal(hasCredentials(), true);
    assert.match(output, /Jira credentials saved/);
    assert.match(output, /JIRA_BASE_URL still overrides the saved Jira base URL when set/);
    assert.match(output, /JIRA_EMAIL still overrides the saved Jira email when set/);
    assert.match(output, /JIRA_API_TOKEN still overrides the saved Jira API token when set/);
    assert.equal(output.includes("secret-jira-token"), false);
  });

  test("credentials reports invalid Jira email and token env overrides clearly", async () => {
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env\n@example.com";
    process.env.JIRA_API_TOKEN = "env-\njira-token";

    const output = await runRegisteredCommand(register, [
      "jira",
      "credentials",
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
    ]);

    assert.equal(hasCredentials(), false);
    assert.match(output, /JIRA_EMAIL is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.match(output, /JIRA_API_TOKEN is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /JIRA_EMAIL still overrides the saved Jira email when set/);
    assert.doesNotMatch(output, /JIRA_API_TOKEN still overrides the saved Jira API token when set/);
  });

  test("credentials reports Jira email and token env overrides with surrounding whitespace as invalid", async () => {
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = " env@example.com ";
    process.env.JIRA_API_TOKEN = " env-jira-token ";

    const output = await runRegisteredCommand(register, [
      "jira",
      "credentials",
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
    ]);

    assert.equal(hasCredentials(), false);
    assert.match(output, /JIRA_EMAIL is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.match(output, /JIRA_API_TOKEN is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /JIRA_EMAIL still overrides the saved Jira email when set/);
    assert.doesNotMatch(output, /JIRA_API_TOKEN still overrides the saved Jira API token when set/);
  });

  test("credentials reports invalid Jira base URL env overrides clearly", async () => {
    process.env.JIRA_BASE_URL = "http://env.atlassian.net";

    const output = await runRegisteredCommand(register, [
      "jira",
      "credentials",
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
    ]);

    resetCache();
    delete process.env.JIRA_BASE_URL;

    assert.equal(hasCredentials(), true);
    assert.match(output, /JIRA_BASE_URL is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /JIRA_BASE_URL still overrides the saved Jira base URL when set/);
  });

  test("credentials reports Jira base URL env overrides with surrounding whitespace as invalid", async () => {
    process.env.JIRA_BASE_URL = " https://env.atlassian.net ";

    const output = await runRegisteredCommand(register, [
      "jira",
      "credentials",
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
    ]);

    resetCache();
    delete process.env.JIRA_BASE_URL;

    assert.equal(hasCredentials(), true);
    assert.match(output, /JIRA_BASE_URL is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /JIRA_BASE_URL still overrides the saved Jira base URL when set/);
  });

  test("remove-credentials reports invalid Jira base URL env overrides clearly", async () => {
    process.env.JIRA_BASE_URL = "http://env.atlassian.net";
    saveCredentials("https://example.atlassian.net", "dev@example.com", "secret-jira-token");

    const output = await runRegisteredCommand(register, ["jira", "remove-credentials"]);

    assert.match(output, /Jira credentials removed/);
    assert.match(output, /JIRA_BASE_URL is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /JIRA_BASE_URL still provides the effective Jira base URL when set/);
  });
});

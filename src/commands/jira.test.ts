import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

import { register } from "./jira.ts";
import { findCommand, optionLongNames, runRegisteredCommand } from "./command-test-support.ts";
import { hasCredentials, saveCredentials } from "../clients/jira.ts";
import * as support from "../clients/jira-test-support.ts";
import { resetCache } from "../credential-store.ts";

let originalConfigDir: string | undefined;
let originalBaseURL: string | undefined;
let originalEmail: string | undefined;
let originalToken: string | undefined;
let originalCloudID: string | undefined;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalBaseURL = process.env.JIRA_BASE_URL;
  originalEmail = process.env.JIRA_EMAIL;
  originalToken = process.env.JIRA_API_TOKEN;
  originalCloudID = process.env.JIRA_CLOUD_ID;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-jira-command-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
  delete process.env.JIRA_CLOUD_ID;
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

  if (originalCloudID === undefined) {
    delete process.env.JIRA_CLOUD_ID;
  } else {
    process.env.JIRA_CLOUD_ID = originalCloudID;
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
    process.env.JIRA_CLOUD_ID = "11111111-2222-3333-4444-555555555555";
    saveCredentials("https://example.atlassian.net", "dev@example.com", "secret-jira-token");

    const output = await runRegisteredCommand(register, ["jira", "remove-credentials"]);

    assert.equal(hasCredentials(), true);
    assert.match(output, /Jira credentials removed/);
    assert.match(output, /JIRA_BASE_URL still provides the effective Jira base URL when set/);
    assert.match(output, /JIRA_EMAIL still provides the effective Jira email when set/);
    assert.match(output, /JIRA_API_TOKEN still provides the effective Jira API token when set/);
    assert.match(output, /JIRA_CLOUD_ID still provides the effective Jira Cloud ID when set/);
    assert.equal(output.includes("secret-jira-token"), false);
  });

  test("credentials reports environment overrides clearly", async () => {
    process.env.JIRA_BASE_URL = "https://env.atlassian.net";
    process.env.JIRA_EMAIL = "env@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";
    process.env.JIRA_CLOUD_ID = "11111111-2222-3333-4444-555555555555";

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
    assert.match(output, /JIRA_CLOUD_ID still overrides the saved Jira Cloud ID when set/);
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

  test("credentials reports invalid Jira Cloud ID env overrides clearly", async () => {
    process.env.JIRA_CLOUD_ID = "not-a-cloud-id";

    const output = await runRegisteredCommand(register, [
      "jira",
      "credentials",
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
    ]);

    assert.match(output, /Jira credentials saved/);
    assert.match(output, /JIRA_CLOUD_ID is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /JIRA_CLOUD_ID still overrides the saved Jira Cloud ID when set/);
  });

  test("remove-credentials reports invalid Jira base URL env overrides clearly", async () => {
    process.env.JIRA_BASE_URL = "http://env.atlassian.net";
    saveCredentials("https://example.atlassian.net", "dev@example.com", "secret-jira-token");

    const output = await runRegisteredCommand(register, ["jira", "remove-credentials"]);

    assert.match(output, /Jira credentials removed/);
    assert.match(output, /JIRA_BASE_URL is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /JIRA_BASE_URL still provides the effective Jira base URL when set/);
  });

  test("credentials persists a Cloud ID positional and routes tickets through the scoped API host", async () => {
    const cloudID = "11111111-2222-3333-4444-555555555555";

    const saveOutput = await runRegisteredCommand(register, [
      "jira",
      "credentials",
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
      cloudID,
    ]);

    assert.equal(hasCredentials(), true);
    assert.match(saveOutput, /Jira credentials saved/);
    assert.equal(saveOutput.includes("secret-jira-token"), false);

    const originalFetch = global.fetch;
    let requestedURL = "";
    global.fetch = async (input: URL | Request | string) => {
      requestedURL = typeof input === "string" ? input : input.toString();
      return support.searchResponse([support.searchIssue("ABC-123")]);
    };

    try {
      const ticketsOutput = await runRegisteredCommand(register, ["jira", "tickets", "--json"]);
      assert.equal(requestedURL, support.searchURL(`https://api.atlassian.com/ex/jira/${cloudID}`));
      assert.match(ticketsOutput, /https:\/\/saved\.atlassian\.net\/browse\/ABC-123/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("credentials rejects an invalid Cloud ID positional at the command boundary", async () => {
    const originalStderrWrite = process.stderr.write;
    const previousExitCode = process.exitCode;
    const errorChunks: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errorChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    let output: string;
    try {
      output = await runRegisteredCommand(register, [
        "jira",
        "credentials",
        "https://saved.atlassian.net",
        "saved@example.com",
        "secret-jira-token",
        "not-a-cloud-id",
      ]);
    } finally {
      process.stderr.write = originalStderrWrite;
      process.exitCode = previousExitCode;
    }

    const errors = errorChunks.join("");
    assert.equal(hasCredentials(), false);
    assert.match(errors, /Jira Cloud ID must be an Atlassian Cloud ID UUID/);
    assert.doesNotMatch(output, /Jira credentials saved/);
    assert.equal(output.includes("secret-jira-token"), false);
  });
});

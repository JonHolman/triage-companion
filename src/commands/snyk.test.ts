import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

import { parseSeverityFilter, register } from "./snyk.ts";
import { findCommand, optionLongNames, runRegisteredCommand } from "./command-test-support.ts";
import { currentAPIBaseURL, hasToken, saveToken } from "../clients/snyk.ts";

let originalConfigDir: string | undefined;
let originalSnykToken: string | undefined;
let originalAPIBaseURL: string | undefined;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalSnykToken = process.env.SNYK_TOKEN;
  originalAPIBaseURL = process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-snyk-command-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  delete process.env.SNYK_TOKEN;
  delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
});

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
  } else {
    process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
  }

  if (originalSnykToken === undefined) {
    delete process.env.SNYK_TOKEN;
  } else {
    process.env.SNYK_TOKEN = originalSnykToken;
  }

  if (originalAPIBaseURL === undefined) {
    delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
  } else {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = originalAPIBaseURL;
  }

  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("snyk command", () => {
  test("parses severity filters case-insensitively", () => {
    assert.equal(parseSeverityFilter(undefined), undefined);
    assert.equal(parseSeverityFilter("HIGH"), "high");
    assert.equal(parseSeverityFilter("critical"), "critical");
  });

  test("rejects invalid severity filters", () => {
    assert.throws(
      () => parseSeverityFilter("urgent"),
      /--severity must be one of: critical, high, medium, low/,
    );
  });

  test("rejects severity filters with surrounding whitespace", () => {
    assert.throws(
      () => parseSeverityFilter(" HIGH "),
      /--severity must not include surrounding whitespace/,
    );
  });

  test("rejects empty severity filters", () => {
    assert.throws(
      () => parseSeverityFilter(""),
      /--severity must not be empty/,
    );
  });

  test("registers token, API base URL, and issue commands", () => {
    const program = new Command();
    register(program);

    const snyk = findCommand(program, "snyk");
    assert.equal(snyk.description(), "Snyk security issues");

    findCommand(snyk, "token");
    findCommand(snyk, "remove-token");
    findCommand(snyk, "api-base-url");
    findCommand(snyk, "reset-api-base-url");

    const issues = findCommand(snyk, "issues");
    assert.deepEqual(optionLongNames(issues), ["--severity", "--json"]);
  });

  test("removes persisted tokens through the direct command", async () => {
    saveToken("secret-snyk-token");
    assert.equal(hasToken(), true);

    const output = await runRegisteredCommand(register, ["snyk", "remove-token"]);

    assert.equal(hasToken(), false);
    assert.match(output, /Snyk token removed/);
    assert.equal(output.includes("secret-snyk-token"), false);
  });

  test("remove-token reports environment tokens clearly", async () => {
    process.env.SNYK_TOKEN = "env-snyk-token";
    saveToken("secret-snyk-token");

    const output = await runRegisteredCommand(register, ["snyk", "remove-token"]);

    assert.equal(hasToken(), true);
    assert.match(output, /Snyk token removed/);
    assert.match(output, /SNYK_TOKEN still provides the effective Snyk token when set/);
    assert.equal(output.includes("secret-snyk-token"), false);
  });

  test("remove-token reports invalid environment tokens clearly", async () => {
    process.env.SNYK_TOKEN = "env-\nsnyk-token";
    saveToken("secret-snyk-token");

    const output = await runRegisteredCommand(register, ["snyk", "remove-token"]);

    assert.equal(hasToken(), false);
    assert.match(output, /SNYK_TOKEN is still set but invalid, so Snyk commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /SNYK_TOKEN still provides the effective Snyk token when set/);
  });

  test("remove-token reports environment tokens with surrounding whitespace as invalid", async () => {
    process.env.SNYK_TOKEN = " env-snyk-token ";
    saveToken("secret-snyk-token");

    const output = await runRegisteredCommand(register, ["snyk", "remove-token"]);

    assert.equal(hasToken(), false);
    assert.match(output, /SNYK_TOKEN is still set but invalid, so Snyk commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /SNYK_TOKEN still provides the effective Snyk token when set/);
  });

  test("api-base-url reports environment overrides clearly", async () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.us.snyk.io/rest";

    const output = await runRegisteredCommand(register, [
      "snyk",
      "api-base-url",
      "https://api.snyk.io/rest",
    ]);

    assert.equal(currentAPIBaseURL(), "https://api.us.snyk.io/rest");
    assert.match(output, /Snyk API base URL saved: https:\/\/api\.snyk\.io\/rest/);
    assert.match(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL still overrides the saved API base URL when set/);
  });

  test("api-base-url reports invalid environment overrides clearly", async () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://example.com/rest";

    const output = await runRegisteredCommand(register, [
      "snyk",
      "api-base-url",
      "https://api.snyk.io/rest",
    ]);

    delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;

    assert.equal(currentAPIBaseURL(), "https://api.snyk.io/rest");
    assert.match(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL is still set but invalid, so Snyk commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL still overrides the saved API base URL when set/);
  });

  test("api-base-url reports environment overrides with surrounding whitespace as invalid", async () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = " https://api.snyk.io/rest ";

    const output = await runRegisteredCommand(register, [
      "snyk",
      "api-base-url",
      "https://api.snyk.io/rest",
    ]);

    delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;

    assert.equal(currentAPIBaseURL(), "https://api.snyk.io/rest");
    assert.match(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL is still set but invalid, so Snyk commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL still overrides the saved API base URL when set/);
  });

  test("reset-api-base-url reports invalid environment overrides clearly", async () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://example.com/rest";

    const output = await runRegisteredCommand(register, ["snyk", "reset-api-base-url"]);

    assert.match(output, /Stored Snyk API base URL reset/);
    assert.match(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL is still set but invalid, so Snyk commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL still overrides the US-01 default when set/);
  });

  test("reset-api-base-url omits override messages when the environment override is unset", async () => {
    const output = await runRegisteredCommand(register, ["snyk", "reset-api-base-url"]);

    assert.match(output, /Stored Snyk API base URL reset/);
    assert.doesNotMatch(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL still overrides/);
    assert.doesNotMatch(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL is still set but invalid/);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { describe, test } from "node:test";

import { hasCredentials as hasJiraCredentials } from "./clients/jira.ts";
import { buildMenuTree, runMenuAction } from "./menu.ts";
import { resetCache } from "./credential-store.ts";

describe("menu Jira actions", () => {
  test("reports invalid Jira base URL env overrides when saving from the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalJiraBaseURL = process.env.JIRA_BASE_URL;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-jira-invalid-base-url-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.JIRA_BASE_URL = "http://env.atlassian.net";
    resetCache();

    const answers = [
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
    ];

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(answers.shift() ?? ""),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const jiraMenu = menu.items.find((item) => item.label === "Jira")?.submenu;
    const setCredentials = jiraMenu?.items.find((item) => item.label === "Set or replace credentials");

    assert.ok(setCredentials?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await setCredentials.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalJiraBaseURL === undefined) {
        delete process.env.JIRA_BASE_URL;
      } else {
        process.env.JIRA_BASE_URL = originalJiraBaseURL;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Jira credentials saved/);
    assert.match(output, /JIRA_BASE_URL is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /JIRA_BASE_URL still overrides the saved Jira base URL when set/);
    assert.equal(output.includes("secret-jira-token"), false);
  });

  test("menu set-credentials rejects Jira base URLs with surrounding whitespace", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalJiraBaseURL = process.env.JIRA_BASE_URL;
    const originalJiraEmail = process.env.JIRA_EMAIL;
    const originalJiraApiToken = process.env.JIRA_API_TOKEN;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-jira-whitespace-base-url-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    resetCache();

    const answers = [
      " https://saved.atlassian.net ",
      "saved@example.com",
      "secret-jira-token",
    ];

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(answers.shift() ?? ""),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const jiraMenu = menu.items.find((item) => item.label === "Jira")?.submenu;
    const setCredentials = jiraMenu?.items.find((item) => item.label === "Set or replace credentials");

    assert.ok(setCredentials?.action);

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    let output = "";
    let errors = "";
    let credentialsConfigured: boolean | undefined;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction(setCredentials);
      credentialsConfigured = hasJiraCredentials();
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalJiraBaseURL === undefined) {
        delete process.env.JIRA_BASE_URL;
      } else {
        process.env.JIRA_BASE_URL = originalJiraBaseURL;
      }
      if (originalJiraEmail === undefined) {
        delete process.env.JIRA_EMAIL;
      } else {
        process.env.JIRA_EMAIL = originalJiraEmail;
      }
      if (originalJiraApiToken === undefined) {
        delete process.env.JIRA_API_TOKEN;
      } else {
        process.env.JIRA_API_TOKEN = originalJiraApiToken;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.equal(credentialsConfigured, false);
    assert.match(errors, /triage-companion menu error: Jira base URL must not include surrounding whitespace/);
    assert.doesNotMatch(output, /Jira credentials saved/);
  });

  test("reports invalid Jira credential env overrides when saving from the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalJiraEmail = process.env.JIRA_EMAIL;
    const originalJiraApiToken = process.env.JIRA_API_TOKEN;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-jira-invalid-credentials-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.JIRA_EMAIL = "env\n@example.com";
    process.env.JIRA_API_TOKEN = "env-\njira-token";
    resetCache();

    const answers = [
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
    ];

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(answers.shift() ?? ""),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const jiraMenu = menu.items.find((item) => item.label === "Jira")?.submenu;
    const setCredentials = jiraMenu?.items.find((item) => item.label === "Set or replace credentials");

    assert.ok(setCredentials?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await setCredentials.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalJiraEmail === undefined) {
        delete process.env.JIRA_EMAIL;
      } else {
        process.env.JIRA_EMAIL = originalJiraEmail;
      }
      if (originalJiraApiToken === undefined) {
        delete process.env.JIRA_API_TOKEN;
      } else {
        process.env.JIRA_API_TOKEN = originalJiraApiToken;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Jira credentials saved/);
    assert.match(output, /JIRA_EMAIL is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.match(output, /JIRA_API_TOKEN is still set but invalid, so Jira commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /JIRA_EMAIL still overrides the saved Jira email when set/);
    assert.doesNotMatch(output, /JIRA_API_TOKEN still overrides the saved Jira API token when set/);
    assert.equal(output.includes("secret-jira-token"), false);
  });
});

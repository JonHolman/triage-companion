import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { describe, test } from "node:test";

import { hasToken as hasGitHubToken, saveToken as saveGitHubToken } from "./clients/github.ts";
import { hasToken as hasSnykToken } from "./clients/snyk.ts";
import { buildMenuTree, runMenuAction } from "./menu.ts";
import { resetCache } from "./credential-store.ts";
import type { MenuNode } from "./menu-types.ts";

function credentialsMenu(serviceLabel: string): MenuNode {
  const serviceMenu = buildMenuTree().items.find((item) => item.label === serviceLabel)?.submenu;
  const credentials = serviceMenu?.items.find((item) => item.label === "Credentials")?.submenu;
  assert.ok(credentials);
  return credentials;
}

describe("menu token actions", () => {
  test("reports Jira API token env overrides when saving from the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalJiraApiToken = process.env.JIRA_API_TOKEN;
    const originalJiraCloudID = process.env.JIRA_CLOUD_ID;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-jira-credentials-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.JIRA_API_TOKEN = "env-jira-token";
    delete process.env.JIRA_CLOUD_ID;
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
    const credentials = jiraMenu?.items.find((item) => item.label === "Credentials")?.submenu;
    const setCredentials = credentials?.items.find((item) => item.label === "Set or replace credentials");

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
      if (originalJiraApiToken === undefined) {
        delete process.env.JIRA_API_TOKEN;
      } else {
        process.env.JIRA_API_TOKEN = originalJiraApiToken;
      }
      if (originalJiraCloudID === undefined) {
        delete process.env.JIRA_CLOUD_ID;
      } else {
        process.env.JIRA_CLOUD_ID = originalJiraCloudID;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Jira credentials saved/);
    assert.match(output, /JIRA_API_TOKEN still overrides the saved Jira API token when set/);
    assert.equal(output.includes("secret-jira-token"), false);
  });

  test("reports invalid GitHub token env overrides when removing from the menu", async () => {
    const originalGitHubToken = process.env.GITHUB_TOKEN;
    const originalCreateInterface = readline.createInterface;
    process.env.GITHUB_TOKEN = "env-\ngithub-token";
    resetCache();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("remove"),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const removeToken = credentialsMenu("GitHub").items.find((item) => item.label === "Remove token");

    assert.ok(removeToken?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await removeToken.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalGitHubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalGitHubToken;
      }
    }

    assert.match(output, /GitHub token removed/);
    assert.match(output, /GITHUB_TOKEN is still set but invalid, so GitHub commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /GITHUB_TOKEN still provides the effective GitHub token when set/);
  });

  test("reports invalid Snyk token env overrides when removing from the menu", async () => {
    const originalSnykToken = process.env.SNYK_TOKEN;
    const originalCreateInterface = readline.createInterface;
    process.env.SNYK_TOKEN = "env-\nsnyk-token";
    resetCache();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("remove"),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const removeToken = credentialsMenu("Snyk").items.find((item) => item.label === "Remove token");

    assert.ok(removeToken?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await removeToken.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalSnykToken === undefined) {
        delete process.env.SNYK_TOKEN;
      } else {
        process.env.SNYK_TOKEN = originalSnykToken;
      }
    }

    assert.match(output, /Snyk token removed/);
    assert.match(output, /SNYK_TOKEN is still set but invalid, so Snyk commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /SNYK_TOKEN still provides the effective Snyk token when set/);
  });

  test("menu remove-token cancels without typed confirmation", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalGitHubToken = process.env.GITHUB_TOKEN;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-github-token-cancel-remove-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    resetCache();
    saveGitHubToken("github-token");

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("q"),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const removeToken = credentialsMenu("GitHub").items.find((item) => item.label === "Remove token");
    assert.ok(removeToken?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await removeToken.action();
      assert.equal(hasGitHubToken(), true);
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalGitHubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalGitHubToken;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /GitHub token removal canceled/);
    assert.doesNotMatch(output, /GitHub token removed/);
  });

  test("menu set-token rejects GitHub tokens with surrounding whitespace", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalGitHubToken = process.env.GITHUB_TOKEN;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-github-token-whitespace-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    resetCache();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(" github-token "),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const setToken = credentialsMenu("GitHub").items.find((item) => item.label === "Set or replace token");

    assert.ok(setToken?.action);

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    let output = "";
    let errors = "";
    let tokenConfigured: boolean | undefined;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction(setToken);
      tokenConfigured = hasGitHubToken();
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
      if (originalGitHubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalGitHubToken;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.equal(tokenConfigured, false);
    assert.match(errors, /triage-companion menu error: GitHub token must not include surrounding whitespace/);
    assert.doesNotMatch(output, /GitHub token saved/);
  });

  test("menu set-token rejects Snyk tokens with surrounding whitespace", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalSnykToken = process.env.SNYK_TOKEN;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-snyk-token-whitespace-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.SNYK_TOKEN;
    resetCache();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(" snyk-token "),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const setToken = credentialsMenu("Snyk").items.find((item) => item.label === "Set or replace token");

    assert.ok(setToken?.action);

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    let output = "";
    let errors = "";
    let tokenConfigured: boolean | undefined;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction(setToken);
      tokenConfigured = hasSnykToken();
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
      if (originalSnykToken === undefined) {
        delete process.env.SNYK_TOKEN;
      } else {
        process.env.SNYK_TOKEN = originalSnykToken;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.equal(tokenConfigured, false);
    assert.match(errors, /triage-companion menu error: Snyk token must not include surrounding whitespace/);
    assert.doesNotMatch(output, /Snyk token saved/);
  });
});

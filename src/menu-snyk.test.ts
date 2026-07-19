import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { describe, test } from "node:test";

import { currentAPIBaseURL } from "./clients/snyk.ts";
import { DEFAULT_SNYK_API_BASE_URL } from "./config-model.ts";
import { buildMenuTree, runMenuAction } from "./menu.ts";

describe("menu Snyk actions", () => {
  test("reports invalid Snyk API base URL env overrides when saving from the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalAPIBaseURL = process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-snyk-api-base-url-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://example.com/rest";

    const answers = ["https://api.snyk.io/rest"];

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(answers.shift() ?? ""),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const configurationMenu = buildMenuTree().items.find((item) => item.label === "Configuration")?.submenu;
    const setAPIBaseURL = configurationMenu?.items.find((item) => item.label === "Set Snyk API base URL");

    assert.ok(setAPIBaseURL?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await setAPIBaseURL.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalAPIBaseURL === undefined) {
        delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
      } else {
        process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = originalAPIBaseURL;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Snyk API base URL saved: https:\/\/api\.snyk\.io\/rest/);
    assert.match(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL is still set but invalid, so Snyk commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL still overrides the saved API base URL when set/);
  });

  test("menu reset-api-base-url omits override messages when the environment override is unset", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalAPIBaseURL = process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-snyk-reset-api-base-url-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;

    const configurationMenu = buildMenuTree().items.find((item) => item.label === "Configuration")?.submenu;
    const resetAPIBaseURL = configurationMenu?.items.find((item) => item.label === "Reset Snyk API base URL");

    assert.ok(resetAPIBaseURL?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await resetAPIBaseURL.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalAPIBaseURL === undefined) {
        delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
      } else {
        process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = originalAPIBaseURL;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Stored Snyk API base URL reset/);
    assert.doesNotMatch(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL still overrides/);
    assert.doesNotMatch(output, /TRIAGE_COMPANION_SNYK_API_BASE_URL is still set but invalid/);
  });

  test("menu set-api-base-url rejects Snyk API base URLs with surrounding whitespace", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalAPIBaseURL = process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-snyk-api-base-url-whitespace-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(" https://api.snyk.io/rest "),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const configurationMenu = buildMenuTree().items.find((item) => item.label === "Configuration")?.submenu;
    const setAPIBaseURL = configurationMenu?.items.find((item) => item.label === "Set Snyk API base URL");

    assert.ok(setAPIBaseURL?.action);

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    let output = "";
    let errors = "";
    let effectiveAPIBaseURL: string | undefined;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction(setAPIBaseURL);
      effectiveAPIBaseURL = currentAPIBaseURL();
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      readline.createInterface = originalCreateInterface;
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalAPIBaseURL === undefined) {
        delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
      } else {
        process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = originalAPIBaseURL;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.equal(effectiveAPIBaseURL, DEFAULT_SNYK_API_BASE_URL);
    assert.match(errors, /triage-companion menu error: Snyk API base URL must not include surrounding whitespace/);
    assert.doesNotMatch(output, /Snyk API base URL saved/);
  });
});

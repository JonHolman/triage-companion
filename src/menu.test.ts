import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { describe, test } from "node:test";

import { hasToken as hasGitHubToken } from "./clients/github.ts";
import { hasCredentials as hasJiraCredentials } from "./clients/jira.ts";
import { currentAPIBaseURL, hasToken as hasSnykToken } from "./clients/snyk.ts";
import { buildConfigurationSummary } from "./config-summary.ts";
import { DEFAULT_SNYK_API_BASE_URL } from "./config-model.ts";
import { buildMenuTree, isMenuInterruptKey, MenuActionReportedError, runMenuAction } from "./menu.ts";
import { resetCache, save } from "./credential-store.ts";
import { readSearchRootsConfig, saveSearchRoots } from "./config.ts";

interface TestMenuItem {
  label: string;
  action?: () => Promise<void> | void;
  submenu?: TestMenuNode;
}

interface TestMenuNode {
  items: TestMenuItem[];
}

function collectLabels(): string[] {
  const labels: string[] = [];
  const walk = (node: TestMenuNode): void => {
    for (const item of node.items) {
      labels.push(item.label);
      if (item.submenu) {
        walk(item.submenu);
      }
    }
  };

  walk(buildMenuTree());
  return labels;
}

describe("menu", () => {
  test("includes all major CLI areas", () => {
    const labels = collectLabels();

    assert.ok(labels.includes("Status"));
    assert.ok(labels.includes("GitHub"));
    assert.ok(labels.includes("Snyk"));
    assert.ok(labels.includes("Jira"));
    assert.ok(labels.includes("Git"));
    assert.ok(labels.includes("Configuration"));
    assert.ok(labels.includes("List notifications"));
    assert.ok(labels.includes("List security alerts"));
    assert.ok(labels.includes("List failed workflows"));
    assert.ok(labels.includes("List my open PRs with login override"));
    assert.ok(labels.includes("List my open PRs with author regex"));
    assert.ok(labels.includes("List issues"));
    assert.ok(labels.includes("List issues by severity"));
    assert.ok(labels.includes("Set API base URL"));
    assert.ok(labels.includes("Reset API base URL"));
    assert.ok(labels.includes("List tickets"));
    assert.ok(labels.includes("List dirty repositories"));
    assert.ok(labels.includes("View configuration"));
    assert.ok(labels.includes("Edit git search roots"));
    assert.ok(labels.includes("Reset git search roots"));
    assert.ok(labels.includes("Set token"));
    assert.ok(labels.includes("Replace token"));
    assert.ok(labels.includes("Remove token"));
    assert.ok(labels.includes("Remove credentials"));
  });

  test("keeps menu actions recoverable after errors", async () => {
    const originalStderrWrite = process.stderr.write;
    const messages: string[] = [];

    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction({
        label: "Broken",
        action: () => {
          throw new Error("broken menu action");
        },
      });
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    assert.match(messages.join(""), /triage-companion menu error: broken menu action/);
  });

  test("escapes control characters in menu action errors", async () => {
    const originalStderrWrite = process.stderr.write;
    const messages: string[] = [];

    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction({
        label: "Broken",
        action: () => {
          throw new Error("broken\tmenu\naction");
        },
      });
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    assert.match(messages.join(""), /triage-companion menu error: broken\\tmenu, action/);
  });

  test("does not duplicate already-reported command failures", async () => {
    const originalStderrWrite = process.stderr.write;
    const messages: string[] = [];

    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction({
        label: "Reported",
        action: () => {
          throw new MenuActionReportedError("triage-companion snyk issues exited with status 1.");
        },
      });
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    assert.equal(messages.join(""), "");
  });

  test("treats ctrl-c as an interactive menu interrupt", () => {
    assert.equal(isMenuInterruptKey({ ctrl: true, name: "c" }), true);
    assert.equal(isMenuInterruptKey({ ctrl: false, name: "c" }), false);
    assert.equal(isMenuInterruptKey({ ctrl: true, name: "x" }), false);
  });

  test("prints configuration from the menu without an extra blank line", async () => {
    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const viewConfiguration = configurationMenu?.items.find((item) => item.label === "View configuration");

    assert.ok(viewConfiguration?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await viewConfiguration.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
    }

    assert.equal(output, buildConfigurationSummary());
  });

  test("reports git search root env overrides when resetting from the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalSearchRootsEnv = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-test-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([path.join(testDir, "env-root")]);
    resetCache();

    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const resetSearchRoots = configurationMenu?.items.find((item) => item.label === "Reset git search roots");

    assert.ok(resetSearchRoots?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await resetSearchRoots.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalSearchRootsEnv === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
      } else {
        process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = originalSearchRootsEnv;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Stored Git search roots cleared/);
    assert.match(output, /TRIAGE_COMPANION_GIT_SEARCH_ROOTS still overrides the defaults when set/);
  });

  test("reports invalid git search root env overrides when resetting from the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalSearchRootsEnv = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-invalid-env-search-roots-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = "{";
    resetCache();

    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const resetSearchRoots = configurationMenu?.items.find((item) => item.label === "Reset git search roots");

    assert.ok(resetSearchRoots?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await resetSearchRoots.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalSearchRootsEnv === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
      } else {
        process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = originalSearchRootsEnv;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Stored Git search roots cleared/);
    assert.match(
      output,
      /TRIAGE_COMPANION_GIT_SEARCH_ROOTS is still set but invalid, so Git repository discovery will fail until it is fixed or unset/,
    );
    assert.doesNotMatch(output, /still overrides the defaults when set/);
  });

  test("treats empty edited git search roots as a reset in the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalSearchRootsEnv = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-edit-search-roots-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([path.join(testDir, "env-root")]);
    resetCache();
    saveSearchRoots([path.join(testDir, "stored-root")]);

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("[]"),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const editSearchRoots = configurationMenu?.items.find((item) => item.label === "Edit git search roots");

    assert.ok(editSearchRoots?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";
    let savedRootsAfterAction: string[] | undefined;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await editSearchRoots.action();
      savedRootsAfterAction = readSearchRootsConfig();
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalSearchRootsEnv === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
      } else {
        process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = originalSearchRootsEnv;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.deepEqual(savedRootsAfterAction, []);
    assert.match(output, /Stored Git search roots cleared/);
    assert.match(output, /TRIAGE_COMPANION_GIT_SEARCH_ROOTS still overrides the defaults when set/);
  });

  test("treats whitespace-only edited git search roots as cancel in the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalSearchRootsEnv = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-whitespace-edit-search-roots-"));
    const storedRoot = path.join(testDir, "stored-root");
    fs.mkdirSync(storedRoot);
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    resetCache();
    saveSearchRoots([storedRoot]);

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("   "),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const editSearchRoots = configurationMenu?.items.find((item) => item.label === "Edit git search roots");

    assert.ok(editSearchRoots?.action);

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    let output = "";
    let errors = "";
    let savedRootsAfterAction: string[] | undefined;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await editSearchRoots.action();
      savedRootsAfterAction = readSearchRootsConfig();
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
      if (originalSearchRootsEnv === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
      } else {
        process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = originalSearchRootsEnv;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.deepEqual(savedRootsAfterAction, [storedRoot]);
    assert.equal(output, "");
    assert.equal(errors, "");
  });

  test("reports invalid git search root env overrides for empty edited roots in the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalSearchRootsEnv = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-invalid-env-edit-search-roots-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = "{";
    resetCache();
    saveSearchRoots([path.join(testDir, "stored-root")]);

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("[]"),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const editSearchRoots = configurationMenu?.items.find((item) => item.label === "Edit git search roots");

    assert.ok(editSearchRoots?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";
    let savedRootsAfterAction: string[] | undefined;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await editSearchRoots.action();
      savedRootsAfterAction = readSearchRootsConfig();
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalSearchRootsEnv === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
      } else {
        process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = originalSearchRootsEnv;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.deepEqual(savedRootsAfterAction, []);
    assert.match(output, /Stored Git search roots cleared/);
    assert.match(
      output,
      /TRIAGE_COMPANION_GIT_SEARCH_ROOTS is still set but invalid, so Git repository discovery will fail until it is fixed or unset/,
    );
    assert.doesNotMatch(output, /still overrides the defaults when set/);
  });

  test("warns in the menu when edited git search roots do not currently exist", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalSearchRootsEnv = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-invalid-search-roots-"));
    const existing = path.join(testDir, "existing");
    const missing = path.join(testDir, "missing");
    fs.mkdirSync(existing);
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    resetCache();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) =>
        callback(JSON.stringify([existing, missing])),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const editSearchRoots = configurationMenu?.items.find((item) => item.label === "Edit git search roots");

    assert.ok(editSearchRoots?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await editSearchRoots.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalSearchRootsEnv === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
      } else {
        process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = originalSearchRootsEnv;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Git search roots saved/);
    assert.match(output, /Some saved roots do not currently exist as directories and will be ignored/);
  });

  test("does not warn in the menu for existing relative git search roots from the current working directory", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalSearchRootsEnv = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    const originalCreateInterface = readline.createInterface;
    const previousCwd = process.cwd();
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-relative-search-roots-"));
    const saveDirectory = path.join(testDir, "save-from");
    fs.mkdirSync(saveDirectory);
    const savedRoot = path.join(fs.realpathSync(saveDirectory), "repos");
    fs.mkdirSync(savedRoot);
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    resetCache();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) =>
        callback(JSON.stringify(["repos"])),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const editSearchRoots = configurationMenu?.items.find((item) => item.label === "Edit git search roots");

    assert.ok(editSearchRoots?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";
    let savedRoots: string[] | undefined;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      process.chdir(saveDirectory);
      await editSearchRoots.action();
      savedRoots = readSearchRootsConfig();
    } finally {
      process.chdir(previousCwd);
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalSearchRootsEnv === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
      } else {
        process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = originalSearchRootsEnv;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.deepEqual(savedRoots, [savedRoot]);
    assert.match(output, /Git search roots saved/);
    assert.doesNotMatch(output, /currently exist/);
  });

  test("allows the menu to repair invalid stored git search roots", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalSearchRootsEnv = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-invalid-stored-search-roots-"));
    const savedRoot = path.join(testDir, "repos");
    fs.mkdirSync(savedRoot);
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    resetCache();
    save("Triage Companion-Config", "git-search-roots", "[1,\u000b2]");
    resetCache();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) =>
        callback(JSON.stringify([savedRoot])),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const editSearchRoots = configurationMenu?.items.find((item) => item.label === "Edit git search roots");

    assert.ok(editSearchRoots?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";
    let savedRoots: string[] | undefined;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await editSearchRoots.action();
      savedRoots = readSearchRootsConfig();
    } finally {
      process.stdout.write = originalStdoutWrite;
      readline.createInterface = originalCreateInterface;
      resetCache();
      if (originalConfigDir === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
      }
      if (originalSearchRootsEnv === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
      } else {
        process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = originalSearchRootsEnv;
      }
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Stored Git search roots are not valid JSON/);
    assert.match(output, /\\u000b/);
    assert.doesNotMatch(output, /\u000b/);
    assert.match(output, /Git search roots saved/);
    assert.deepEqual(savedRoots, [savedRoot]);
  });

  test("reports Jira API token env overrides when saving from the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalJiraApiToken = process.env.JIRA_API_TOKEN;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-jira-credentials-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.JIRA_API_TOKEN = "env-jira-token";
    resetCache();

    const answers = [
      "https://saved.atlassian.net",
      "saved@example.com",
      "secret-jira-token",
    ];

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(answers.shift() ?? ""),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const jiraMenu = menu.items.find((item) => item.label === "Jira")?.submenu;
    const setCredentials = jiraMenu?.items.find((item) => item.label === "Set credentials");

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
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    assert.match(output, /Jira credentials saved/);
    assert.match(output, /JIRA_API_TOKEN still overrides the saved Jira API token when set/);
    assert.equal(output.includes("secret-jira-token"), false);
  });

  test("reports invalid GitHub token env overrides when removing from the menu", () => {
    const originalGitHubToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "env-\ngithub-token";
    resetCache();

    const menu = buildMenuTree();
    const githubMenu = menu.items.find((item) => item.label === "GitHub")?.submenu;
    const removeToken = githubMenu?.items.find((item) => item.label === "Remove token");

    assert.ok(removeToken?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      removeToken.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
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

  test("reports invalid Snyk token env overrides when removing from the menu", () => {
    const originalSnykToken = process.env.SNYK_TOKEN;
    process.env.SNYK_TOKEN = "env-\nsnyk-token";
    resetCache();

    const menu = buildMenuTree();
    const snykMenu = menu.items.find((item) => item.label === "Snyk")?.submenu;
    const removeToken = snykMenu?.items.find((item) => item.label === "Remove token");

    assert.ok(removeToken?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      removeToken.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
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
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const githubMenu = menu.items.find((item) => item.label === "GitHub")?.submenu;
    const setToken = githubMenu?.items.find((item) => item.label === "Set token");

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
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const snykMenu = menu.items.find((item) => item.label === "Snyk")?.submenu;
    const setToken = snykMenu?.items.find((item) => item.label === "Set token");

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
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const jiraMenu = menu.items.find((item) => item.label === "Jira")?.submenu;
    const setCredentials = jiraMenu?.items.find((item) => item.label === "Set credentials");

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
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const jiraMenu = menu.items.find((item) => item.label === "Jira")?.submenu;
    const setCredentials = jiraMenu?.items.find((item) => item.label === "Set credentials");

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
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const jiraMenu = menu.items.find((item) => item.label === "Jira")?.submenu;
    const setCredentials = jiraMenu?.items.find((item) => item.label === "Set credentials");

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

  test("reports invalid Snyk API base URL env overrides when saving from the menu", async () => {
    const originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const originalAPIBaseURL = process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    const originalCreateInterface = readline.createInterface;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-snyk-api-base-url-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://example.com/rest";
    resetCache();

    const answers = ["https://api.snyk.io/rest"];

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(answers.shift() ?? ""),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const snykMenu = menu.items.find((item) => item.label === "Snyk")?.submenu;
    const setAPIBaseURL = snykMenu?.items.find((item) => item.label === "Set API base URL");

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
      resetCache();
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
    resetCache();

    const menu = buildMenuTree();
    const snykMenu = menu.items.find((item) => item.label === "Snyk")?.submenu;
    const resetAPIBaseURL = snykMenu?.items.find((item) => item.label === "Reset API base URL");

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
      resetCache();
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
    resetCache();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback(" https://api.snyk.io/rest "),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const snykMenu = menu.items.find((item) => item.label === "Snyk")?.submenu;
    const setAPIBaseURL = snykMenu?.items.find((item) => item.label === "Set API base URL");

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
      resetCache();
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

  test("menu login override treats whitespace-only input as cancel", async () => {
    const originalCreateInterface = readline.createInterface;
    const originalSpawnSync = childProcess.spawnSync;
    let spawnCalls = 0;

    childProcess.spawnSync = ((..._args: Parameters<typeof childProcess.spawnSync>) => {
      spawnCalls += 1;
      return {
        error: undefined,
        signal: null,
        status: 0,
      } as unknown as ReturnType<typeof childProcess.spawnSync>;
    }) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("   "),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const githubMenu = menu.items.find((item) => item.label === "GitHub")?.submenu;
    const listWithLogin = githubMenu?.items.find((item) => item.label === "List my open PRs with login override");

    assert.ok(listWithLogin?.action);

    try {
      await listWithLogin.action();
    } finally {
      readline.createInterface = originalCreateInterface;
      childProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
    }

    assert.equal(spawnCalls, 0);
  });

  test("menu author regex override treats whitespace-only input as cancel", async () => {
    const originalCreateInterface = readline.createInterface;
    const originalSpawnSync = childProcess.spawnSync;
    let spawnCalls = 0;

    childProcess.spawnSync = ((..._args: Parameters<typeof childProcess.spawnSync>) => {
      spawnCalls += 1;
      return {
        error: undefined,
        signal: null,
        status: 0,
      } as unknown as ReturnType<typeof childProcess.spawnSync>;
    }) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("   "),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const githubMenu = menu.items.find((item) => item.label === "GitHub")?.submenu;
    const listWithRegex = githubMenu?.items.find((item) => item.label === "List my open PRs with author regex");

    assert.ok(listWithRegex?.action);

    try {
      await listWithRegex.action();
    } finally {
      readline.createInterface = originalCreateInterface;
      childProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
    }

    assert.equal(spawnCalls, 0);
  });
});

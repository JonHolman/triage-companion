import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { describe, test } from "node:test";

import { buildMenuTree } from "./menu.ts";
import { resetCache, save } from "./credential-store.ts";
import { readSearchRootsConfig, saveSearchRoots } from "./config.ts";

describe("menu configuration actions", () => {
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
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

import { register } from "./config.ts";
import { findCommand, runRegisteredCommand } from "./command-test-support.ts";
import { readSearchRootsConfig } from "../config.ts";
import { resetCache } from "../credential-store.ts";

let originalConfigDir: string | undefined;
let originalSearchRootsEnv: string | undefined;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalSearchRootsEnv = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-config-command-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
  resetCache();
});

afterEach(() => {
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
});

describe("config command registration", () => {
  test("registers configuration inspection and git search root commands", () => {
    const program = new Command();
    register(program);

    const config = findCommand(program, "config");
    assert.equal(config.description(), "Configuration management");

    assert.equal(
      findCommand(config, "show").description(),
      "Show configured values without exposing secrets",
    );
    assert.equal(
      findCommand(config, "git-search-roots").description(),
      "Save Git repository search roots",
    );
    assert.equal(
      findCommand(config, "reset-git-search-roots").description(),
      "Reset Git repository search roots to defaults",
    );
  });

  test("saves git search roots through the direct command", async () => {
    const one = path.join(testDir, `one${process.platform === "win32" ? ";" : ":"}part`);
    const two = path.join(testDir, "two");
    fs.mkdirSync(one);
    fs.mkdirSync(two);

    const output = await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      JSON.stringify([one, two]),
    ]);

    assert.deepEqual(readSearchRootsConfig(), [one, two]);
    assert.match(output, /Git search roots saved/);
  });

  test("stores relative git search roots from the current working directory", async () => {
    const previousCwd = process.cwd();
    const saveDirectory = path.join(testDir, "save-from");
    fs.mkdirSync(saveDirectory);
    const savedRoot = path.join(fs.realpathSync(saveDirectory), "repos");
    fs.mkdirSync(savedRoot);

    try {
      process.chdir(saveDirectory);
      const output = await runRegisteredCommand(register, [
        "config",
        "git-search-roots",
        JSON.stringify(["repos"]),
      ]);

      assert.deepEqual(readSearchRootsConfig(), [savedRoot]);
      assert.ok(output.includes(`Git search roots saved: ${savedRoot}`));
      assert.doesNotMatch(output, /currently exist/);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("git-search-roots reports environment overrides clearly", async () => {
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([path.join(testDir, "env-root")]);
    const one = path.join(testDir, "one");
    const two = path.join(testDir, "two");

    const output = await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      JSON.stringify([one, two]),
    ]);

    assert.deepEqual(readSearchRootsConfig(), [one, two]);
    assert.match(output, /Git search roots saved/);
    assert.match(output, /TRIAGE_COMPANION_GIT_SEARCH_ROOTS still overrides the saved roots when set/);
  });

  test("git-search-roots reports invalid environment overrides clearly", async () => {
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = "{";
    const one = path.join(testDir, "one");
    const two = path.join(testDir, "two");

    const output = await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      JSON.stringify([one, two]),
    ]);

    assert.deepEqual(readSearchRootsConfig(), [one, two]);
    assert.match(output, /Git search roots saved/);
    assert.match(
      output,
      /TRIAGE_COMPANION_GIT_SEARCH_ROOTS is still set but invalid, so Git repository discovery will fail until it is fixed or unset/,
    );
    assert.doesNotMatch(output, /still overrides the saved roots when set/);
  });

  test("git-search-roots rejects blank direct input instead of treating it like a reset", async () => {
    const one = path.join(testDir, "one");
    fs.mkdirSync(one);

    const savedOutput = await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      JSON.stringify([one]),
    ]);

    assert.match(savedOutput, /Git search roots saved/);
    assert.deepEqual(readSearchRootsConfig(), [one]);

    const originalStderrWrite = process.stderr.write;
    const stderrChunks: string[] = [];
    const previousExitCode = process.exitCode;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runRegisteredCommand(register, ["config", "git-search-roots", " "]);
    } finally {
      process.stderr.write = originalStderrWrite;
      process.exitCode = previousExitCode;
    }

    assert.match(stderrChunks.join(""), /Git search roots must be a JSON array of non-empty strings/);
    assert.deepEqual(readSearchRootsConfig(), [one]);
  });

  test("git-search-roots rejects surrounding whitespace around the JSON input", async () => {
    const one = path.join(testDir, "one");
    fs.mkdirSync(one);

    const savedOutput = await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      JSON.stringify([one]),
    ]);

    assert.match(savedOutput, /Git search roots saved/);
    assert.deepEqual(readSearchRootsConfig(), [one]);

    const originalStderrWrite = process.stderr.write;
    const stderrChunks: string[] = [];
    const previousExitCode = process.exitCode;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runRegisteredCommand(register, [
        "config",
        "git-search-roots",
        ` ${JSON.stringify([one])} `,
      ]);
    } finally {
      process.stderr.write = originalStderrWrite;
      process.exitCode = previousExitCode;
    }

    assert.match(stderrChunks.join(""), /Git search roots must not include surrounding whitespace/);
    assert.deepEqual(readSearchRootsConfig(), [one]);
  });

  test("git-search-roots warns when some saved roots do not currently exist", async () => {
    const existing = path.join(testDir, "existing");
    const missing = path.join(testDir, "missing");
    fs.mkdirSync(existing);

    const output = await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      JSON.stringify([existing, missing]),
    ]);

    assert.deepEqual(readSearchRootsConfig(), [existing, missing]);
    assert.match(output, /Git search roots saved/);
    assert.match(output, /Some saved roots do not currently exist as directories and will be ignored/);
  });

  test("git-search-roots warns when all saved roots are currently invalid", async () => {
    const missingOne = path.join(testDir, "missing-one");
    const missingTwo = path.join(testDir, "missing-two");

    const output = await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      JSON.stringify([missingOne, missingTwo]),
    ]);

    assert.deepEqual(readSearchRootsConfig(), [missingOne, missingTwo]);
    assert.match(output, /None of the saved roots currently exist as directories, so Git repository discovery will return no repositories/);
  });

  test("git-search-roots empty input reports environment overrides like a reset", async () => {
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([path.join(testDir, "env-root")]);

    const output = await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      "[]",
    ]);

    assert.deepEqual(readSearchRootsConfig(), []);
    assert.match(output, /Stored Git search roots cleared/);
    assert.match(output, /TRIAGE_COMPANION_GIT_SEARCH_ROOTS still overrides the defaults when set/);
  });

  test("git-search-roots empty input reports invalid environment overrides clearly", async () => {
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = "{";

    const output = await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      "[]",
    ]);

    assert.deepEqual(readSearchRootsConfig(), []);
    assert.match(output, /Stored Git search roots cleared/);
    assert.match(
      output,
      /TRIAGE_COMPANION_GIT_SEARCH_ROOTS is still set but invalid, so Git repository discovery will fail until it is fixed or unset/,
    );
    assert.doesNotMatch(output, /still overrides the defaults when set/);
  });

  test("resets git search roots through the direct command", async () => {
    const one = path.join(testDir, "one");
    const two = path.join(testDir, "two");
    fs.mkdirSync(one);
    fs.mkdirSync(two);

    await runRegisteredCommand(register, [
      "config",
      "git-search-roots",
      JSON.stringify([one, two]),
    ]);
    const output = await runRegisteredCommand(register, ["config", "reset-git-search-roots"]);

    assert.deepEqual(readSearchRootsConfig(), []);
    assert.match(output, /Git search roots reset to defaults/);
  });

  test("reset-git-search-roots reports environment overrides clearly", async () => {
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([path.join(testDir, "env-root")]);

    const output = await runRegisteredCommand(register, ["config", "reset-git-search-roots"]);

    assert.match(output, /Stored Git search roots cleared/);
    assert.match(output, /TRIAGE_COMPANION_GIT_SEARCH_ROOTS still overrides the defaults when set/);
  });

  test("reset-git-search-roots reports invalid environment overrides clearly", async () => {
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = "{";

    const output = await runRegisteredCommand(register, ["config", "reset-git-search-roots"]);

    assert.match(output, /Stored Git search roots cleared/);
    assert.match(
      output,
      /TRIAGE_COMPANION_GIT_SEARCH_ROOTS is still set but invalid, so Git repository discovery will fail until it is fixed or unset/,
    );
    assert.doesNotMatch(output, /still overrides the defaults when set/);
  });
});

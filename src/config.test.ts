import assert from "node:assert/strict";
import { beforeEach, afterEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_GIT_SEARCH_ROOTS,
  ENV,
  resolveSearchRoots,
  saveSearchRoots,
  readSearchRootsConfig,
  clearSearchRoots,
} from "./config.ts";
import { save } from "./credential-store.ts";

const GIT_SEARCH_ROOTS_ENV = ENV.GIT_SEARCH_ROOTS;

let originalSearchRootsEnv: string | undefined;
let originalConfigDir: string | undefined;
let originalHome: string | undefined;
let rootBase: string;
let configDir: string;
const PATH_DELIMITER = process.platform === "win32" ? ";" : ":";

beforeEach(() => {
  originalSearchRootsEnv = process.env[GIT_SEARCH_ROOTS_ENV];
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalHome = process.env.HOME;
  rootBase = fs.mkdtempSync(path.join(os.tmpdir(), "triage-search-roots-"));
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-config-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = configDir;
  process.env[GIT_SEARCH_ROOTS_ENV] = "";
  clearSearchRoots();
});

afterEach(() => {
  if (originalSearchRootsEnv === undefined) {
    delete process.env[GIT_SEARCH_ROOTS_ENV];
  } else {
    process.env[GIT_SEARCH_ROOTS_ENV] = originalSearchRootsEnv;
  }

  if (originalConfigDir === undefined) {
    delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
  } else {
    process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  fs.rmSync(rootBase, { recursive: true, force: true });
  fs.rmSync(configDir, { recursive: true, force: true });
});

describe("config search roots", () => {
  test("uses sensible defaults and filters to existing directories", () => {
    const defaults = DEFAULT_GIT_SEARCH_ROOTS as readonly string[];
    assert.ok(defaults.includes("Projects"));
    assert.ok(defaults.includes("repos"));
    assert.ok(!defaults.includes("Desktop"));
    assert.ok(!defaults.includes("Downloads"));

    const projects = path.join(rootBase, "Projects");
    const repos = path.join(rootBase, "repos");
    const code = path.join(rootBase, "code");

    fs.mkdirSync(projects);
    fs.mkdirSync(repos);
    fs.mkdirSync(code);

    const roots = resolveSearchRoots(undefined, rootBase);
    assert.equal(roots.length, 3);
    assert.deepEqual(roots, [projects, repos, code]);
  });

  test("resolves JSON env overrides and preserves explicit order", () => {
    const configured1 = path.join(rootBase, `repo${PATH_DELIMITER}home`);
    const configured2 = path.join(rootBase, "repo-team");
    const missing = path.join(rootBase, "missing");
    const invalidFile = path.join(rootBase, "not-a-dir.txt");

    fs.mkdirSync(configured1);
    fs.mkdirSync(configured2);
    fs.writeFileSync(invalidFile, "noop");

    process.env[GIT_SEARCH_ROOTS_ENV] = JSON.stringify([configured1, missing, invalidFile, configured2]);

    const roots = resolveSearchRoots(undefined, rootBase);
    assert.deepEqual(roots, [configured1, configured2]);
  });

  test("uses defaults when env value is empty", () => {
    const expectedOne = path.join(rootBase, "Projects");
    const expectedTwo = path.join(rootBase, "repos");

    fs.mkdirSync(expectedOne);
    fs.mkdirSync(expectedTwo);

    process.env[GIT_SEARCH_ROOTS_ENV] = "  ";
    const roots = resolveSearchRoots(undefined, rootBase);
    assert.deepEqual(roots, [expectedOne, expectedTwo]);
  });

  test("rejects env search roots with surrounding whitespace around the JSON value", () => {
    const configured = path.join(rootBase, "configured");
    fs.mkdirSync(configured);

    process.env[GIT_SEARCH_ROOTS_ENV] = ` ${JSON.stringify([configured])} `;

    assert.throws(
      () => resolveSearchRoots(undefined, rootBase),
      /Git search roots must not include surrounding whitespace/,
    );
  });

  test("uses stored roots when env is absent", () => {
    const configuredOne = path.join(rootBase, "alpha");
    const configuredTwo = path.join(rootBase, "beta");
    fs.mkdirSync(configuredOne);
    fs.mkdirSync(configuredTwo);

    saveSearchRoots([configuredOne, configuredTwo]);
    delete process.env[GIT_SEARCH_ROOTS_ENV];

    assert.deepEqual(readSearchRootsConfig(), [configuredOne, configuredTwo]);
    assert.deepEqual(resolveSearchRoots(undefined, rootBase), [configuredOne, configuredTwo]);
  });

  test("rejects stored search roots with surrounding whitespace around the JSON value", () => {
    const configured = path.join(rootBase, "configured");
    fs.mkdirSync(configured);
    save("Triage Companion-Config", "git-search-roots", ` ${JSON.stringify([configured])} `);

    assert.throws(
      () => readSearchRootsConfig(),
      /Stored Git search roots must not include surrounding whitespace/,
    );
    assert.throws(
      () => resolveSearchRoots(undefined, rootBase),
      /Stored Git search roots must not include surrounding whitespace/,
    );
  });

  test("treats an explicit empty env array as an override to no search roots", () => {
    const storedRoot = path.join(rootBase, "stored");
    fs.mkdirSync(storedRoot);
    saveSearchRoots([storedRoot]);

    process.env[GIT_SEARCH_ROOTS_ENV] = "[]";

    assert.deepEqual(resolveSearchRoots(undefined, rootBase), []);
  });

  test("stores roots with path separator characters without splitting them", () => {
    const configuredOne = path.join(rootBase, `repo${PATH_DELIMITER}with-delimiter`);
    const configuredTwo = path.join(rootBase, "beta");
    fs.mkdirSync(configuredOne);
    fs.mkdirSync(configuredTwo);

    saveSearchRoots([configuredOne, configuredTwo]);
    delete process.env[GIT_SEARCH_ROOTS_ENV];

    assert.deepEqual(readSearchRootsConfig(), [configuredOne, configuredTwo]);
    assert.deepEqual(resolveSearchRoots(undefined, rootBase), [configuredOne, configuredTwo]);
  });

  test("rejects whitespace-only stored search root entries", () => {
    save("Triage Companion-Config", "git-search-roots", '["   "]');

    assert.throws(
      () => readSearchRootsConfig(),
      /Stored Git search roots must be a JSON array of non-empty strings/,
    );
    assert.throws(
      () => resolveSearchRoots(undefined, rootBase),
      /Stored Git search roots must be a JSON array of non-empty strings/,
    );
  });

  test("rejects blank stored search root config values", () => {
    save("Triage Companion-Config", "git-search-roots", "");

    assert.throws(
      () => readSearchRootsConfig(),
      /Stored Git search roots are not valid JSON/,
    );
    assert.throws(
      () => resolveSearchRoots(undefined, rootBase),
      /Stored Git search roots are not valid JSON/,
    );
  });

  test("escapes control characters in stored search root JSON parse errors", () => {
    save("Triage Companion-Config", "git-search-roots", "[1,\u000b2]");

    assert.throws(() => {
      readSearchRootsConfig();
    }, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Stored Git search roots are not valid JSON/);
      assert.match(error.message, /\\u000b/);
      assert.doesNotMatch(error.message, /\u000b/);
      return true;
    });

    assert.throws(() => {
      resolveSearchRoots(undefined, rootBase);
    }, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Stored Git search roots are not valid JSON/);
      assert.match(error.message, /\\u000b/);
      assert.doesNotMatch(error.message, /\u000b/);
      return true;
    });
  });

  test("rejects stored search root entries with control characters", () => {
    save("Triage Companion-Config", "git-search-roots", '["/tmp/repo\\tbad"]');

    assert.throws(
      () => readSearchRootsConfig(),
      /Stored Git search roots must contain paths without control characters/,
    );
    assert.throws(
      () => resolveSearchRoots(undefined, rootBase),
      /Stored Git search roots must contain paths without control characters/,
    );
  });

  test("rejects stored search root entries with surrounding whitespace", () => {
    save("Triage Companion-Config", "git-search-roots", '[" /tmp/repo "]');

    assert.throws(
      () => readSearchRootsConfig(),
      /Stored Git search roots must contain paths without surrounding whitespace/,
    );
    assert.throws(
      () => resolveSearchRoots(undefined, rootBase),
      /Stored Git search roots must contain paths without surrounding whitespace/,
    );
  });

  test("stores relative roots relative to the save-time working directory", () => {
    const previousCwd = process.cwd();
    const saveDirectory = path.join(rootBase, "save-from");
    const otherDirectory = path.join(rootBase, "other");
    fs.mkdirSync(saveDirectory);
    fs.mkdirSync(otherDirectory);
    const savedRoot = path.join(fs.realpathSync(saveDirectory), "repos");
    fs.mkdirSync(savedRoot);

    try {
      process.chdir(saveDirectory);
      assert.deepEqual(saveSearchRoots(["repos"]), [savedRoot]);
      assert.deepEqual(readSearchRootsConfig(), [savedRoot]);

      process.chdir(otherDirectory);
      assert.deepEqual(resolveSearchRoots(undefined, rootBase), [savedRoot]);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("rejects relative roots when the save-time working directory has control characters", () => {
    const previousCwd = process.cwd();
    const badDirectory = `${path.join(rootBase, "save-from")}\tbad`;
    fs.mkdirSync(badDirectory, { recursive: true });

    try {
      process.chdir(badDirectory);
      assert.throws(
        () => saveSearchRoots(["repos"]),
        /Git search roots must contain paths without control characters\./,
      );
      assert.deepEqual(readSearchRootsConfig(), []);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("rejects blank roots instead of treating them like a reset", () => {
    const savedRoot = path.join(rootBase, "saved-root");
    fs.mkdirSync(savedRoot);
    saveSearchRoots([savedRoot]);

    assert.throws(
      () => saveSearchRoots(["", "  "]),
      /Git search roots must not contain blank entries/,
    );
    assert.deepEqual(readSearchRootsConfig(), [savedRoot]);
  });

  test("returns empty list when all configured paths are invalid", () => {
    const missing1 = path.join(rootBase, "nope");
    const missing2 = path.join(rootBase, "missing", "nested");
    process.env[GIT_SEARCH_ROOTS_ENV] = JSON.stringify([missing1, missing2]);

    const roots = resolveSearchRoots(undefined, rootBase);
    assert.deepEqual(roots, []);
  });

  test("accepts explicit JSON search roots", () => {
    const one = path.join(rootBase, "one");
    const two = path.join(rootBase, "two");
    fs.mkdirSync(one);
    fs.writeFileSync(two, "");

    const roots = resolveSearchRoots(JSON.stringify([one, two]));
    assert.deepEqual(roots, [one]);
  });

  test("rejects invalid explicit search root JSON clearly", () => {
    assert.throws(
      () => resolveSearchRoots("not-json"),
      /Git search roots must be a JSON array of non-empty strings/,
    );
  });

  test("rejects blank explicit search root input instead of treating it as omitted", () => {
    assert.throws(
      () => resolveSearchRoots("   "),
      /Git search roots must be a JSON array of non-empty strings/,
    );
  });

  test("rejects whitespace-only explicit search root entries", () => {
    assert.throws(
      () => resolveSearchRoots('["   "]'),
      /Git search roots must be a JSON array of non-empty strings/,
    );
  });

  test("rejects explicit search root entries with control characters", () => {
    assert.throws(
      () => resolveSearchRoots('["/tmp/repo\\tbad"]'),
      /Git search roots must contain paths without control characters/,
    );
  });

  test("rejects explicit search root entries with surrounding whitespace", () => {
    assert.throws(
      () => resolveSearchRoots('[" /tmp/repo "]'),
      /Git search roots must contain paths without surrounding whitespace/,
    );
  });

  test("expands home-relative configured roots", () => {
    const repos = path.join(rootBase, "repos");
    fs.mkdirSync(repos);

    process.env[GIT_SEARCH_ROOTS_ENV] = JSON.stringify(["~/repos"]);
    assert.deepEqual(resolveSearchRoots(undefined, rootBase), [repos]);

    delete process.env[GIT_SEARCH_ROOTS_ENV];
    saveSearchRoots(["~/repos"]);
    assert.deepEqual(resolveSearchRoots(undefined, rootBase), [repos]);
    assert.deepEqual(resolveSearchRoots(JSON.stringify(["~/repos"]), rootBase), [repos]);
  });

  test("rejects home-relative configured roots when HOME has control characters", () => {
    process.env.HOME = `${fs.mkdtempSync(path.join(os.tmpdir(), "triage-home-search-root-"))}\tbad`;
    process.env[GIT_SEARCH_ROOTS_ENV] = JSON.stringify(["~/repos"]);

    assert.throws(
      () => resolveSearchRoots(),
      /Home directory is invalid: must not include control characters/,
    );
  });

  test("resolves explicit absolute roots without requiring a valid HOME", () => {
    const configured = path.join(rootBase, "configured");
    fs.mkdirSync(configured);
    process.env.HOME = `${fs.mkdtempSync(path.join(os.tmpdir(), "triage-home-search-root-"))}\tbad`;

    assert.deepEqual(resolveSearchRoots(JSON.stringify([configured])), [configured]);
  });
});

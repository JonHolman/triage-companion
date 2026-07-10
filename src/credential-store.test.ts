import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, beforeEach, afterEach, test } from "node:test";

import {
  configFilePath,
  read,
  readCredential,
  remove,
  resetCache,
  save,
  updateMany,
} from "./credential-store.ts";

let originalConfigDir: string | undefined;
let testDir: string;

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-credentials-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  resetCache();
});

afterEach(() => {
  resetCache();
  if (originalConfigDir === undefined) {
    delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
  } else {
    process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
  }

  fs.rmSync(testDir, { force: true, recursive: true });
});

describe("credential-store", () => {
  test("saves and reads raw values", () => {
    save("triage", "token", "  abc123  ");
    assert.equal(read("triage", "token"), "  abc123  ");
  });

  test("updates multiple values in one write without trimming", () => {
    updateMany([
      { service: "triage", account: "base-url", value: " https://example.test " },
      { service: "triage", account: "email", value: " dev@example.test " },
      { service: "triage", account: "token", value: " token " },
    ]);

    assert.equal(read("triage", "base-url"), " https://example.test ");
    assert.equal(read("triage", "email"), " dev@example.test ");
    assert.equal(read("triage", "token"), " token ");

    updateMany([
      { service: "triage", account: "email", value: null },
      { service: "triage", account: "token", value: null },
    ]);

    assert.equal(read("triage", "base-url"), " https://example.test ");
    assert.equal(read("triage", "email"), null);
    assert.equal(read("triage", "token"), null);
  });

  test("does not create a store file for missing removals", () => {
    remove("triage", "token");

    assert.equal(fs.existsSync(configFilePath()), false);
  });

  test("does not create a store file for missing multi-key removals", () => {
    updateMany([
      { service: "triage", account: "email", value: null },
      { service: "triage", account: "token", value: null },
    ]);

    assert.equal(fs.existsSync(configFilePath()), false);
  });

  test("does not leave temporary files after saving", () => {
    save("triage", "token", "abc123");
    const entries = fs.readdirSync(path.dirname(configFilePath()));

    assert.equal(entries.some((entry) => entry.endsWith(".tmp")), false);
  });

  test("removes temporary files when saving fails after temp write", () => {
    const fp = configFilePath();
    save("triage", "existing", "one");
    fs.rmSync(fp, { force: true });
    fs.mkdirSync(fp, { recursive: true });

    assert.throws(() => save("triage", "token", "abc123"));

    const entries = fs.readdirSync(path.dirname(fp));
    assert.equal(entries.some((entry) => entry.endsWith(".tmp")), false);
  });

  test("uses environment variables when store is empty", () => {
    process.env.SOME_TEST_TOKEN = "env-token";
    assert.equal(
      readCredential("triage", "missing", "SOME_TEST_TOKEN"),
      "env-token",
    );
    delete process.env.SOME_TEST_TOKEN;
  });

  test("preserves raw environment credential values", () => {
    process.env.SOME_TEST_TOKEN = " env-token ";
    assert.equal(
      readCredential("triage", "missing", "SOME_TEST_TOKEN"),
      " env-token ",
    );
    delete process.env.SOME_TEST_TOKEN;
  });

  test("does not fall back to the environment when a stored credential is present but invalid", () => {
    save("triage", "token", "");
    process.env.SOME_TEST_TOKEN = "env-token";

    try {
      assert.equal(readCredential("triage", "token", "SOME_TEST_TOKEN"), "");
    } finally {
      delete process.env.SOME_TEST_TOKEN;
    }
  });

  test("rejects unreadable stores instead of using environment variables", () => {
    const fp = configFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, "not json", { encoding: "utf-8" });
    resetCache();
    process.env.SOME_TEST_TOKEN = "env-token";

    try {
      assert.throws(
        () => readCredential("triage", "missing", "SOME_TEST_TOKEN"),
        /not valid JSON/,
      );
    } finally {
      delete process.env.SOME_TEST_TOKEN;
    }
  });

  test("returns null when config file is missing", () => {
    assert.equal(read("triage", "token"), null);
  });

  test("throws if stored JSON is invalid", () => {
    const fp = configFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, "not json", { encoding: "utf-8" });
    resetCache();

    assert.throws(() => read("triage", "token"), /not valid JSON/);
  });

  test("does not echo corrupt credential store content into the parse error", () => {
    const fp = configFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, '{"github": ghp_supersecrettoken123}', { encoding: "utf-8" });
    resetCache();

    assert.throws(
      () => read("triage", "token"),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /not valid JSON/);
        assert.ok(!message.includes("ghp_supersecrettoken123"));
        assert.ok(!message.includes("github"));
        return true;
      },
    );
  });

  test("rejects home directories with control characters before reading the credential store", () => {
    const originalHome = process.env.HOME;
    const originalConfigDirValue = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "triage-home-"));
    const badHome = `${homeRoot}\twith-tab`;
    const secretsPath = path.join(
      badHome,
      "Library",
      "Application Support",
      "Triage Companion",
      "secrets.json",
    );
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, "not json", { encoding: "utf-8" });

    try {
      delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      process.env.HOME = badHome;
      resetCache();

      assert.throws(
        () => read("triage", "token"),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /Home directory is invalid: must not include control characters\./);
          assert.equal(message.includes("\t"), false);
          return true;
        },
      );
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalConfigDirValue === undefined) {
        delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
      } else {
        process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDirValue;
      }
      resetCache();
      fs.rmSync(homeRoot, { recursive: true, force: true });
    }
  });

  test("throws if stored values are not strings", () => {
    const fp = configFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({ broken: 123 }), { encoding: "utf-8" });
    resetCache();

    assert.throws(() => read("triage", "token"), /must be a string/);
  });

  test("does not echo malformed stored key names in type errors", () => {
    const fp = configFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({ "bad\tkey": 123 }), { encoding: "utf-8" });
    resetCache();

    assert.throws(
      () => read("triage", "token"),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /Credential store value must be a string\./);
        assert.equal(message.includes("\t"), false);
        return true;
      },
    );
  });

  test("treats special object property names as inert stored keys", () => {
    const fp = configFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, '{"__proto__":"ignored","constructor":"ignored"}', { encoding: "utf-8" });
    resetCache();

    assert.equal(read("triage", "token"), null);
    save("triage", "token", "abc123");
    assert.equal(read("triage", "token"), "abc123");
  });

  test("does not overwrite invalid stored JSON when saving", () => {
    const fp = configFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, "not json", { encoding: "utf-8" });
    resetCache();

    assert.throws(() => save("triage", "token", "abc123"), /not valid JSON/);
    assert.equal(fs.readFileSync(fp, "utf-8"), "not json");
  });

  test("does not update cached values when saving fails", () => {
    const blockedPath = path.join(testDir, "blocked");
    fs.writeFileSync(blockedPath, "not a directory");
    process.env.TRIAGE_COMPANION_CONFIG_DIR = blockedPath;
    resetCache();

    assert.throws(() => save("triage", "token", "abc123"));
    assert.throws(() => read("triage", "token"));
  });

  test("rejects permission errors during secret writes", () => {
    const originalChmodSync = fs.chmodSync;
    fs.chmodSync = (() => {
      throw new Error("chmod failed");
    }) as typeof fs.chmodSync;

    try {
      assert.throws(() => save("triage", "token", "abc123"), /chmod failed/);
      assert.equal(read("triage", "token"), null);
    } finally {
      fs.chmodSync = originalChmodSync;
    }
  });

  test("does not remove a temp path when exclusive creation fails", () => {
    const originalOpenSync = fs.openSync;
    const originalRmSync = fs.rmSync;
    const removedPaths: string[] = [];

    fs.openSync = (() => {
      const error = new Error("temp already exists") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    }) as typeof fs.openSync;
    fs.rmSync = ((target: string | URL, options?: { force?: boolean; recursive?: boolean }) => {
      removedPaths.push(String(target));
      return originalRmSync(target, options);
    }) as typeof fs.rmSync;

    try {
      assert.throws(() => save("triage", "token", "abc123"), /temp already exists/);
      assert.deepEqual(removedPaths, []);
      assert.equal(read("triage", "token"), null);
    } finally {
      fs.openSync = originalOpenSync;
      fs.rmSync = originalRmSync;
    }
  });
});

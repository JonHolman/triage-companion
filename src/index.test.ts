import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const ENTRY_POINT = fileURLToPath(new URL("./index.ts", import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const REPO_ROOT = path.dirname(PACKAGE_JSON_PATH);

function normalizeOutput(text: string | null | undefined): string {
  const value = text ?? "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

function isolatedEnv(configDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TRIAGE_COMPANION_CONFIG_DIR: configDir,
  };
}

function runEntryPoint(args: string[]): SpawnSyncReturns<string> {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-entrypoint-config-"));
  try {
    return spawnSync(process.execPath, [ENTRY_POINT, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: isolatedEnv(configDir),
    });
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

function toTclLiteral(value: string): string {
  return `{` + value.replace(/}/g, "\\}") + `}`;
}

function runEntryPointWithTTY(args: string[]): SpawnSyncReturns<string> {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-entrypoint-tty-config-"));
  const spawnCommand = [process.execPath, ENTRY_POINT, ...args]
    .map(toTclLiteral)
    .join(" ");
  const expectScript = [
    "log_user 1",
    "set timeout 5",
    `spawn ${spawnCommand}`,
    "expect \"*Use arrow keys and Enter*\"",
    "after 100",
    "send \"q\"",
    "expect eof",
    "set waitResult [wait]",
    'puts "exit:[lindex $waitResult 3]"',
  ].join("; ");

  try {
    return spawnSync("expect", ["-c", expectScript], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: isolatedEnv(configDir),
    });
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

// The PTY tests need the expect binary (see README); when it is missing they
// skip with that reason instead of failing on a confusing spawn ENOENT.
const PTY_TEST_SKIP_REASON =
  process.platform === "win32" ||
  spawnSync("expect", ["-c", "exit 0"], { encoding: "utf8" }).error !== undefined
    ? "requires a PTY driven by the expect binary"
    : false;

// Drives a full menu round trip in a real PTY: run an action, return through
// the pause prompt, then navigate back out. Guards against stdin being left
// paused after a prompt, which kills the key reader for the rest of the run.
function runMenuActionRoundTripWithTTY(configDir: string): SpawnSyncReturns<string> {
  const spawnCommand = [process.execPath, ENTRY_POINT, "menu"].map(toTclLiteral).join(" ");
  const expectScript = [
    "log_user 1",
    "set timeout 10",
    `spawn ${spawnCommand}`,
    "expect \"*Use arrow keys and Enter*\"",
    "after 100",
    'send "\\033\\[B\\033\\[B\\033\\[B"',
    "after 100",
    'send "\\r"',
    "expect \"*View configuration*\"",
    "after 100",
    'send "\\r"',
    "expect \"*Press Enter to continue*\"",
    "after 100",
    'send "\\r"',
    "expect \"*Use arrow keys and Enter*\"",
    "after 100",
    'send "q"',
    "expect \"*Exit*\"",
    "after 100",
    'send "q"',
    "expect eof",
    "set waitResult [wait]",
    'puts "exit:[lindex $waitResult 3]"',
  ].join("; ");

  return spawnSync("expect", ["-c", expectScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: isolatedEnv(configDir),
  });
}

describe("cli entrypoint", () => {
  test("keeps the package entrypoints wired to src/index.ts", () => {
    const packageJSON = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    assert.equal(packageJSON.bin?.["triage-companion"], "./src/index.ts");
    assert.equal(packageJSON.scripts?.start, "node src/index.ts");
  });

  test("prints help from the real entrypoint", () => {
    const result = runEntryPoint(["--help"]);

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Usage: triage-companion \[options\] \[command\]/);
    assert.match(result.stdout, /menu\s+Open the interactive terminal menu/);
  });

  test("requires a TTY for bare menu invocation", () => {
    const result = runEntryPoint([]);
    const output = normalizeOutput(`${result.stdout}${result.stderr}`);

    assert.equal(result.status, 1);
    assert.match(output, /triage-companion interactive menu requires a TTY/);
    assert.doesNotMatch(output, /Use arrow keys and Enter/);
  });

  test("opens the menu on bare TTY invocation", { skip: PTY_TEST_SKIP_REASON }, () => {
    const result = runEntryPointWithTTY([]);
    const output = normalizeOutput(
      `${result.stdout}${result.stderr}${result.error?.message ?? ""}`,
    );

    assert.equal(result.error, undefined);
    assert.match(output, /triage-companion/);
    assert.match(output, /Use arrow keys and Enter/);
    assert.match(output, /exit:0/);
  });

  test(
    "keeps reading menu keys after an action and its pause prompt",
    { skip: PTY_TEST_SKIP_REASON },
    (t) => {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-roundtrip-"));
      t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

      const result = runMenuActionRoundTripWithTTY(configDir);
      const output = normalizeOutput(
        `${result.stdout}${result.stderr}${result.error?.message ?? ""}`,
      );

      assert.equal(result.error, undefined);
      assert.doesNotMatch(output, /Detected unsettled top-level await/);
      assert.match(output, /exit:0/);
    },
  );

  test("requires a TTY for the explicit menu command", () => {
    const result = runEntryPoint(["menu"]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /triage-companion interactive menu requires a TTY/);
  });
});

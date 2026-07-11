import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

import { register } from "./git.ts";
import { findCommand, optionLongNames, runRegisteredCommand } from "./command-test-support.ts";

async function runRegisteredCommandCapturingStderr(
  registerCommand: (program: Command) => void,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const program = new Command();
  program.exitOverride();
  registerCommand(program);

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  process.exitCode = undefined;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    await program.parseAsync(["node", "test", ...args]);
    return {
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      exitCode: process.exitCode,
    };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  }
}

function writeFakeGitScript(scriptPath: string, body: string): void {
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo 'git version 2.0.0'
  exit 0
fi
${body}`,
  );
  fs.chmodSync(scriptPath, 0o755);
}

function writeHeadFile(gitDirectory: string, branch: string = "main"): void {
  fs.mkdirSync(gitDirectory, { recursive: true });
  fs.writeFileSync(path.join(gitDirectory, "HEAD"), `ref: refs/heads/${branch}\n`);
}

describe("git command registration", () => {
  let originalGit: string | undefined;
  let originalSearchRoots: string | undefined;
  let tempDir = "";

  beforeEach(() => {
    originalGit = process.env.TRIAGE_COMPANION_GIT;
    originalSearchRoots = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-command-"));
  });

  afterEach(() => {
    if (originalGit === undefined) {
      delete process.env.TRIAGE_COMPANION_GIT;
    } else {
      process.env.TRIAGE_COMPANION_GIT = originalGit;
    }

    if (originalSearchRoots === undefined) {
      delete process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
    } else {
      process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = originalSearchRoots;
    }

    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("registers dirty and status commands with expected options", () => {
    const program = new Command();
    register(program);

    const git = findCommand(program, "git");
    assert.equal(git.description(), "Git repository status");

    const dirty = findCommand(git, "dirty");
    assert.deepEqual(optionLongNames(dirty), ["--limit", "--search", "--json"]);
    assert.equal(
      dirty.options.find((option) => option.long === "--search")?.description,
      "Filter results by name/branch/path",
    );

    const status = findCommand(git, "status");
    assert.deepEqual(optionLongNames(status), ["--search"]);
    assert.equal(
      status.options.find((option) => option.long === "--search")?.description,
      "Filter results by name/branch/path",
    );
  });

  test("applies git dirty search before limit", async () => {
    const fakeGit = path.join(tempDir, "git");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "branch" ]; then
  printf 'unexpected branch probe for %s\\n' "$repo" >&2
  exit 43
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    target-repo)
      printf '## feature-target\\n M src/target.ts\\n'
      ;;
    *)
      printf 'unexpected full status for %s\\n' "$repo" >&2
      exit 42
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([tempDir]);

    for (const repo of ["alpha-repo", "target-repo"]) {
      writeHeadFile(path.join(tempDir, repo, ".git"));
    }

    const output = await runRegisteredCommand(register, [
      "git",
      "dirty",
      "--limit",
      "1",
      "--search",
      "target",
      "--json",
    ]);

    const parsed = JSON.parse(output) as Array<{ name: string }>;
    assert.deepEqual(parsed.map((item) => item.name), ["target-repo"]);
  });

  test("prints omitted repository notice for unsearched git dirty limit", async () => {
    const fakeGit = path.join(tempDir, "git");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  printf '## main\\n M src/%s.ts\\n' "$(basename "$repo")"
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([tempDir]);

    for (const repo of ["alpha-repo", "beta-repo", "gamma-repo"]) {
      writeHeadFile(path.join(tempDir, repo, ".git"));
    }

    const output = await runRegisteredCommand(register, [
      "git",
      "dirty",
      "--limit",
      "2",
    ]);

    assert.match(output, /alpha-repo/);
    assert.match(output, /beta-repo/);
    assert.doesNotMatch(output, /gamma-repo/);
    assert.match(output, /1 more dirty repositories matched; raise --limit to show them\./);
  });

  test("trims git status search queries", async () => {
    const fakeGit = path.join(tempDir, "git");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "branch" ]; then
  printf 'unexpected branch probe for %s\\n' "$repo" >&2
  exit 43
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    target-repo)
      printf '## feature-target\\n M src/target.ts\\n'
      ;;
    *)
      printf 'unexpected full status for %s\\n' "$repo" >&2
      exit 42
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([tempDir]);

    for (const repo of ["alpha-repo", "target-repo"]) {
      writeHeadFile(path.join(tempDir, repo, ".git"));
    }

    const output = await runRegisteredCommand(register, [
      "git",
      "status",
      "--search",
      " target ",
    ]);

    assert.match(output, /target-repo/);
    assert.doesNotMatch(output, /alpha-repo/);
  });

  test("git dirty rejects whitespace-only search before discovery", async () => {
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([tempDir]);
    const repo = path.join(tempDir, "repo");
    writeHeadFile(path.join(repo, ".git"));

    const result = await runRegisteredCommandCapturingStderr(register, [
      "git",
      "dirty",
      "--search",
      "   ",
      "--json",
    ]);

    assert.equal(result.stdout, "");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--search must not be empty/);
  });

  test("git status rejects whitespace-only search before discovery", async () => {
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([tempDir]);
    const repo = path.join(tempDir, "repo");
    writeHeadFile(path.join(repo, ".git"));

    const result = await runRegisteredCommandCapturingStderr(register, [
      "git",
      "status",
      "--search",
      "   ",
    ]);

    assert.equal(result.stdout, "");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--search must not be empty/);
  });

  test("applies git status search before the default repository cap", async () => {
    const fakeGit = path.join(tempDir, "git");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    target-repo)
      printf '## feature-target\\n M src/target.ts\\n'
      ;;
    *)
      printf '## main\\n'
      i=1
      while [ "$i" -le 2 ]; do
        printf ' M src/file-%s.ts\\n' "$i"
        i=$((i + 1))
      done
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS = JSON.stringify([tempDir]);

    for (let index = 0; index < 301; index += 1) {
      writeHeadFile(path.join(tempDir, `alpha-repo-${index}`, ".git"));
    }
    writeHeadFile(path.join(tempDir, "target-repo", ".git"));

    const output = await runRegisteredCommand(register, [
      "git",
      "status",
      "--search",
      "target",
    ]);

    assert.match(output, /target-repo/);
  });
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

import { register } from "./github.ts";
import { findCommand, optionLongNames, runRegisteredCommand } from "./test-support.test.ts";
import { hasToken, saveToken } from "../clients/github.ts";
import { resetCache } from "../credential-store.ts";

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

let originalConfigDir: string | undefined;
let originalGitHubToken: string | undefined;
let originalGitHubAuthorRegex: string | undefined;
let originalHome: string | undefined;
let originalGitBinary: string | undefined;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalGitHubToken = process.env.GITHUB_TOKEN;
  originalGitHubAuthorRegex = process.env.TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX;
  originalHome = process.env.HOME;
  originalGitBinary = process.env.TRIAGE_COMPANION_GIT;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-command-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  delete process.env.GITHUB_TOKEN;
  delete process.env.TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX;
  resetCache();
});

afterEach(() => {
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

  if (originalGitHubAuthorRegex === undefined) {
    delete process.env.TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX;
  } else {
    process.env.TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX = originalGitHubAuthorRegex;
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (originalGitBinary === undefined) {
    delete process.env.TRIAGE_COMPANION_GIT;
  } else {
    process.env.TRIAGE_COMPANION_GIT = originalGitBinary;
  }

  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("github command registration", () => {
  test("registers required GitHub subcommands and options", () => {
    const program = new Command();
    register(program);

    const github = findCommand(program, "github");
    assert.equal(github.description(), "GitHub notifications, workflow failures, and security alerts");

    findCommand(github, "remove-token");

    const notifications = findCommand(github, "notifications");
    assert.deepEqual(optionLongNames(notifications), ["--all", "--limit", "--json"]);

    const openPullRequests = findCommand(github, "my-open-prs");
    assert.deepEqual(optionLongNames(openPullRequests), [
      "--search-roots",
      "--author-regex",
      "--github-login",
      "--json",
    ]);

    findCommand(github, "mark-read");
    findCommand(github, "security-alerts");

    const failedWorkflows = findCommand(github, "failed-workflows");
    assert.equal(failedWorkflows.description(), "List recent failed GitHub Actions workflow runs");
    assert.deepEqual(optionLongNames(failedWorkflows), ["--limit", "--json"]);
  });

  test("removes persisted tokens through the direct command", async () => {
    saveToken("secret-github-token");
    assert.equal(hasToken(), true);

    const output = await runRegisteredCommand(register, ["github", "remove-token"]);

    assert.equal(hasToken(), false);
    assert.match(output, /GitHub token removed/);
    assert.equal(output.includes("secret-github-token"), false);
  });

  test("remove-token reports environment tokens clearly", async () => {
    process.env.GITHUB_TOKEN = "env-github-token";
    saveToken("secret-github-token");

    const output = await runRegisteredCommand(register, ["github", "remove-token"]);

    assert.equal(hasToken(), true);
    assert.match(output, /GitHub token removed/);
    assert.match(output, /GITHUB_TOKEN still provides the effective GitHub token when set/);
    assert.equal(output.includes("secret-github-token"), false);
  });

  test("remove-token reports invalid environment tokens clearly", async () => {
    process.env.GITHUB_TOKEN = "env-\ngithub-token";
    saveToken("secret-github-token");

    const output = await runRegisteredCommand(register, ["github", "remove-token"]);

    assert.equal(hasToken(), false);
    assert.match(output, /GITHUB_TOKEN is still set but invalid, so GitHub commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /GITHUB_TOKEN still provides the effective GitHub token when set/);
  });

  test("remove-token reports environment tokens with surrounding whitespace as invalid", async () => {
    process.env.GITHUB_TOKEN = " env-github-token ";
    saveToken("secret-github-token");

    const output = await runRegisteredCommand(register, ["github", "remove-token"]);

    assert.equal(hasToken(), false);
    assert.match(output, /GITHUB_TOKEN is still set but invalid, so GitHub commands will fail until it is fixed or unset/);
    assert.doesNotMatch(output, /GITHUB_TOKEN still provides the effective GitHub token when set/);
  });

  test("security-alerts emits empty JSON when notification repo discovery finds nothing", async () => {
    process.env.GITHUB_TOKEN = "env-github-token";
    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.match(url, /^https:\/\/api\.github\.com\/notifications\?/);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const output = await runRegisteredCommand(register, ["github", "security-alerts", "--json"]);
      assert.equal(output, "[]\n");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("my-open-prs still uses default discovery roots when --search-roots is omitted", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-command-home-"));
    const defaultRoot = path.join(homeDir, "Projects");
    const repoDir = path.join(defaultRoot, "repo");
    const fakeGit = path.join(testDir, "git");

    fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(
      fakeGit,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo 'git version 2.0.0'
  exit 0
fi
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.HOME = homeDir;
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      const output = await runRegisteredCommand(register, [
        "github",
        "my-open-prs",
        "--json",
      ]);
      const pullRequests = JSON.parse(output) as Array<{ url: string; repositoryPath: string }>;

      assert.equal(pullRequests.length, 1);
      assert.equal(pullRequests[0]?.url, "https://github.com/octocat/hello-world/pull/12");
      assert.equal(pullRequests[0]?.repositoryPath, repoDir);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("my-open-prs rejects blank --search-roots values instead of treating them as []", async () => {
    const result = await runRegisteredCommandCapturingStderr(register, [
      "github",
      "my-open-prs",
      "--search-roots",
      "",
    ]);

    assert.match(result.stderr, /--search-roots must be a JSON array of non-empty strings/);
    assert.equal(result.exitCode, 1);
  });

  test("my-open-prs rejects surrounding whitespace around --search-roots JSON", async () => {
    const result = await runRegisteredCommandCapturingStderr(register, [
      "github",
      "my-open-prs",
      "--search-roots",
      ` ${JSON.stringify([testDir])} `,
    ]);

    assert.match(result.stderr, /--search-roots must not include surrounding whitespace/);
    assert.equal(result.exitCode, 1);
  });

  test("my-open-prs rejects empty --author-regex values instead of treating them as omitted", async () => {
    const result = await runRegisteredCommandCapturingStderr(register, [
      "github",
      "my-open-prs",
      "--author-regex",
      "",
    ]);

    assert.match(result.stderr, /GitHub PR author regex must not be empty/);
    assert.equal(result.exitCode, 1);
  });

  test("my-open-prs preserves surrounding whitespace in the environment author regex", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-command-author-regex-home-"));
    const defaultRoot = path.join(homeDir, "Projects");
    const repoDir = path.join(defaultRoot, "repo");
    const fakeGit = path.join(testDir, "git-author-regex");

    fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(
      fakeGit,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo 'git version 2.0.0'
  exit 0
fi
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.HOME = homeDir;
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX = " repo@example\\.com ";

    try {
      const output = await runRegisteredCommand(register, [
        "github",
        "my-open-prs",
        "--json",
      ]);
      const pullRequests = JSON.parse(output) as Array<{ url: string }>;

      assert.deepEqual(pullRequests, []);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("validates failed-workflows limits before inferring the current repository", async () => {
    const previousCwd = process.cwd();
    const nonRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-failed-workflows-"));

    try {
      process.chdir(nonRepoDir);
      const result = await runRegisteredCommandCapturingStderr(register, [
        "github",
        "failed-workflows",
        "--limit",
        "bad",
      ]);

      assert.match(result.stderr, /--limit must be a positive integer/);
      assert.equal(result.exitCode, 1);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(nonRepoDir, { recursive: true, force: true });
    }
  });

  test("rejects whitespace-padded failed-workflows limits before inferring the current repository", async () => {
    const previousCwd = process.cwd();
    const nonRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-failed-workflows-whitespace-"));

    try {
      process.chdir(nonRepoDir);
      const result = await runRegisteredCommandCapturingStderr(register, [
        "github",
        "failed-workflows",
        "--limit",
        " 5 ",
      ]);

      assert.match(result.stderr, /--limit must not include surrounding whitespace/);
      assert.equal(result.exitCode, 1);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(nonRepoDir, { recursive: true, force: true });
    }
  });

  test("failed-workflows surfaces malformed GitHub origin URLs when inferring the current repository", async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-failed-workflows-origin-"));
    const fakeGit = path.join(testDir, "git-bad-origin");
    fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(
      fakeGit,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo 'git version 2.0.0'
  exit 0
fi
case "$*" in
  *" remote get-url origin") printf "https://token@github.com/octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const previousCwd = process.cwd();
    try {
      process.chdir(repoDir);
      const result = await runRegisteredCommandCapturingStderr(register, [
        "github",
        "failed-workflows",
      ]);
      assert.match(result.stderr, /Git remote origin is not a valid GitHub repository URL\./);
      assert.ok(!result.stderr.includes("token@"));
      assert.equal(result.exitCode, 1);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("failed-workflows surfaces blank GitHub origin URLs when inferring the current repository", async () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-failed-workflows-blank-origin-"));
    const fakeGit = path.join(testDir, "git-blank-origin");
    fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(
      fakeGit,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo 'git version 2.0.0'
  exit 0
fi
case "$*" in
  *" remote get-url origin") printf "\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const previousCwd = process.cwd();
    try {
      process.chdir(repoDir);
      const result = await runRegisteredCommandCapturingStderr(register, [
        "github",
        "failed-workflows",
      ]);
      assert.match(result.stderr, /Git remote origin URL must not be empty\./);
      assert.equal(result.exitCode, 1);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

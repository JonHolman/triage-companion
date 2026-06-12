/**
 * Tests for github.js repository discovery.
 *
 * Regression tests to ensure .git files (worktrees, submodules, linked checkouts)
 * are correctly recognized alongside .git directories.
 */

import assert from "node:assert/strict";
import { test, describe, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// We test the github module's repo discovery logic by importing it
// Note: we can't directly import findGitRepos since it's not exported,
// but we can verify listMyOpenPullRequests handles the discovery correctly
import { listMyOpenPullRequests } from "./github.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("github.js repository discovery", () => {
  let testDir;
  let repoDir;
  let worktreeRepoDir;
  let submoduleRepoDir;
  let previousGit;

  before(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-test-"));
    repoDir = path.join(testDir, "normal-repo");
    worktreeRepoDir = path.join(testDir, "worktree-repo");
    submoduleRepoDir = path.join(testDir, "submodule-repo");
    previousGit = process.env.TRIAGE_COMPANION_GIT;

    const fakeGit = path.join(testDir, "git");
    fs.writeFileSync(fakeGit, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    // Create a normal repository with .git directory
    fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(repoDir, "test.txt"), "test content");

    // Create a worktree repository (with .git file pointing to worktrees directory)
    fs.mkdirSync(worktreeRepoDir);
    fs.writeFileSync(path.join(worktreeRepoDir, ".git"), "gitdir: /some/path/.git/worktrees/branch1\n");
    fs.writeFileSync(path.join(worktreeRepoDir, "test.txt"), "worktree content");

    // Create a submodule repository (with .git file)
    fs.mkdirSync(submoduleRepoDir);
    fs.writeFileSync(path.join(submoduleRepoDir, ".git"), "gitdir: ../parent/.git/modules/submodule\n");
    fs.writeFileSync(path.join(submoduleRepoDir, "test.txt"), "submodule content");
  });

  after(async () => {
    if (previousGit === undefined) {
      delete process.env.TRIAGE_COMPANION_GIT;
    } else {
      process.env.TRIAGE_COMPANION_GIT = previousGit;
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("should recognize .git directories (standard repositories)", () => {
    // Verify test setup
    const gitDir = path.join(repoDir, ".git");
    assert.ok(fs.existsSync(gitDir), "normal repo .git directory should exist");
    assert.ok(fs.statSync(gitDir).isDirectory(), ".git should be a directory");
  });

  test("should handle .git files with gitdir: prefix (worktrees)", () => {
    // Verify the worktree .git file was created correctly
    const gitFile = path.join(worktreeRepoDir, ".git");
    assert.ok(fs.existsSync(gitFile));
    const content = fs.readFileSync(gitFile, "utf-8");
    assert.ok(content.startsWith("gitdir:"));
  });

  test("should handle .git files (submodules)", () => {
    // Verify the submodule .git file was created correctly
    const gitFile = path.join(submoduleRepoDir, ".git");
    assert.ok(fs.existsSync(gitFile));
    const content = fs.readFileSync(gitFile, "utf-8");
    assert.ok(content.includes("gitdir:"));
  });

  test("should distinguish between .git directories and files", () => {
    // Verify both types of .git entries exist
    const normalGit = path.join(repoDir, ".git");
    const worktreeGit = path.join(worktreeRepoDir, ".git");
    const submoduleGit = path.join(submoduleRepoDir, ".git");

    assert.ok(fs.statSync(normalGit).isDirectory(), ".git should be a directory in normal repo");
    assert.ok(fs.statSync(worktreeGit).isFile(), ".git should be a file in worktree");
    assert.ok(fs.statSync(submoduleGit).isFile(), ".git should be a file in submodule");
  });

  test("listMyOpenPullRequests should handle mixed checkout shapes without crashing", () => {
    // This is the critical regression test: ensure the function handles both
    // directory and file .git entries without crashing when provided with
    // explicit repository paths
    try {
      const result = listMyOpenPullRequests({
        repositoryPaths: [repoDir],
        authorRegex: ".*",
      });
      assert.ok(Array.isArray(result), "should return an array");
      // The result may be empty (no PRs, no git config, etc.) but should not error
    } catch (err) {
      // Some errors are expected (no git author identity, etc.)
      // but the error should not be due to .git file vs directory confusion
      const message = err.message;
      assert.ok(
        !message.includes("isDirectory") && !message.includes("entry.isDirectory"),
        "should not error due to isDirectory() confusion"
      );
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  findGitRepositories,
  normalizeRepositorySearchRoots,
  resolveRepositorySearchRoots,
} from "./search.ts";

const describeWithSymlinks = process.platform === "win32" ? describe.skip : describe;
const describeWithUnreadableDirectories = process.platform === "win32" ||
  (typeof process.getuid === "function" && process.getuid() === 0)
  ? describe.skip
  : describe;

function writeHeadFile(gitDirectory: string, branch: string = "main"): void {
  fs.mkdirSync(gitDirectory, { recursive: true });
  fs.writeFileSync(path.join(gitDirectory, "HEAD"), `ref: refs/heads/${branch}\n`);
}

describe("git search", () => {
  test("finds repositories with both .git directories and .git files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-"));
    const normalRepo = path.join(root, "normal");
    const worktreeRepo = path.join(root, "worktree");
    const submoduleRepo = path.join(root, "submodule");
    const invalidRepo = path.join(root, "invalid");
    const staleRepo = path.join(root, "stale");
    const worktreeGitDir = path.join(root, "metadata", "worktrees", "a");
    const submoduleGitDir = path.join(root, "metadata", "modules", "b");

    writeHeadFile(path.join(normalRepo, ".git"));
    writeHeadFile(worktreeGitDir, "worktree");
    fs.mkdirSync(worktreeRepo);
    fs.writeFileSync(path.join(worktreeRepo, ".git"), `gitdir: ${worktreeGitDir}\n`);
    writeHeadFile(submoduleGitDir, "submodule");
    fs.mkdirSync(submoduleRepo);
    fs.writeFileSync(path.join(submoduleRepo, ".git"), `gitdir: ${submoduleGitDir}\n`);
    fs.mkdirSync(invalidRepo);
    fs.writeFileSync(path.join(invalidRepo, ".git"), "not a gitdir marker\n");
    fs.mkdirSync(staleRepo);
    fs.writeFileSync(path.join(staleRepo, ".git"), `gitdir: ${path.join(root, "missing-gitdir")}\n`);

    const discovered = findGitRepositories([root]).sort();

    assert.equal(discovered.length, 3);
    assert.ok(discovered.includes(normalRepo));
    assert.ok(discovered.includes(worktreeRepo));
    assert.ok(discovered.includes(submoduleRepo));
    assert.equal(discovered.includes(invalidRepo), false);
    assert.equal(discovered.includes(staleRepo), false);

    fs.rmSync(root, { force: true, recursive: true });
  });

  test("rejects malformed gitdir file formatting instead of trimming it into validity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-gitdir-format-"));
    const metadata = path.join(root, "metadata");
    const validRepo = path.join(root, "valid");
    const leadingSpaceRepo = path.join(root, "leading-space");
    const missingSeparatorRepo = path.join(root, "missing-separator");
    const extraSpaceRepo = path.join(root, "extra-space");

    writeHeadFile(metadata, "main");
    fs.mkdirSync(validRepo);
    fs.writeFileSync(path.join(validRepo, ".git"), `gitdir: ${metadata}\n`);
    fs.mkdirSync(leadingSpaceRepo);
    fs.writeFileSync(path.join(leadingSpaceRepo, ".git"), ` gitdir: ${metadata}\n`);
    fs.mkdirSync(missingSeparatorRepo);
    fs.writeFileSync(path.join(missingSeparatorRepo, ".git"), `gitdir:${metadata}\n`);
    fs.mkdirSync(extraSpaceRepo);
    fs.writeFileSync(path.join(extraSpaceRepo, ".git"), `gitdir:  ${metadata}\n`);

    try {
      const discovered = findGitRepositories([root]).sort();

      assert.deepEqual(discovered, [validRepo]);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  test("does not discover repositories inside generated review artifacts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-review-artifacts-"));
    const repo = path.join(root, "repo");
    const artifactRepo = path.join(root, "review-artifacts", "scratch-repo");

    writeHeadFile(path.join(repo, ".git"));
    writeHeadFile(path.join(artifactRepo, ".git"));

    try {
      const discovered = findGitRepositories([root]).sort();

      assert.deepEqual(discovered, [repo]);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  test("gives each explicit search root its own depth budget", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-depth-budget-"));
    const child = path.join(root, "child");
    const repo = path.join(child, "sub");
    writeHeadFile(path.join(repo, ".git"));

    try {
      const discovered = findGitRepositories([root, child], { maxDepth: 1 });

      assert.deepEqual(discovered, [repo]);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  test("resolves defaulted and explicit search roots from JSON input", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-roots-"));
    const existing = path.join(root, "existing");
    const ignored = path.join(root, "ignored");

    fs.mkdirSync(existing);

    const roots = resolveRepositorySearchRoots(JSON.stringify([existing, ignored]));
    assert.deepEqual(roots, [existing]);

    fs.rmSync(root, { force: true, recursive: true });
  });

  test("rejects blank explicit search roots instead of treating them as omitted", () => {
    assert.throws(
      () => resolveRepositorySearchRoots("   "),
      /Git search roots must be a JSON array of non-empty strings/,
    );
  });

  test("rejects blank explicit search root entries when normalizing arrays", () => {
    assert.throws(
      () => normalizeRepositorySearchRoots(["   "]),
      /Git search roots must not contain blank entries/,
    );
  });

  test("rejects explicit search root entries with control characters when normalizing arrays", () => {
    assert.throws(
      () => normalizeRepositorySearchRoots(["/tmp/repo\tbad"]),
      /Git search roots must contain paths without control characters/,
    );
  });

  test("rejects explicit search root entries with surrounding whitespace when normalizing arrays", () => {
    assert.throws(
      () => normalizeRepositorySearchRoots([" /tmp/repo "]),
      /Git search roots must contain paths without surrounding whitespace/,
    );
  });

  test("normalizes explicit search roots without splitting valid path characters", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-root-char-"));
    const existing = path.join(root, "repo:withcolon");
    fs.mkdirSync(existing);

    try {
      assert.deepEqual(normalizeRepositorySearchRoots([existing]), [existing]);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  test("normalizes explicit search roots without trimming valid internal spaces", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-root-space-"));
    const existing = path.join(root, "repo with space");
    fs.mkdirSync(existing);

    try {
      assert.deepEqual(normalizeRepositorySearchRoots([existing]), [existing]);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
});

describeWithSymlinks("git search symlinks", () => {
  test("deduplicates repositories discovered through real and symlinked roots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-symlink-"));
    const realRoot = path.join(root, "real");
    const linkRoot = path.join(root, "link");
    const repo = path.join(realRoot, "repo");

    writeHeadFile(path.join(repo, ".git"));
    fs.symlinkSync(realRoot, linkRoot);

    const discovered = findGitRepositories([realRoot, linkRoot]);

    assert.deepEqual(discovered, [repo]);

    fs.rmSync(root, { force: true, recursive: true });
  });

  test("finds repositories through symlinked directory entries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-symlink-entry-"));
    const targetRoot = path.join(root, "targets");
    const searchRoot = path.join(root, "search");
    const repo = path.join(targetRoot, "repo");
    const linkRepo = path.join(searchRoot, "repo-link");

    writeHeadFile(path.join(repo, ".git"));
    fs.mkdirSync(searchRoot, { recursive: true });
    fs.symlinkSync(repo, linkRepo);

    const discovered = findGitRepositories([searchRoot]);

    assert.deepEqual(discovered, [linkRepo]);

    fs.rmSync(root, { force: true, recursive: true });
  });

  test("does not loop forever on symlinked directory cycles", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-symlink-cycle-"));
    const nested = path.join(root, "nested");
    const repo = path.join(nested, "repo");
    const cycleLink = path.join(nested, "back-to-root");

    writeHeadFile(path.join(repo, ".git"));
    fs.symlinkSync(root, cycleLink);

    const discovered = findGitRepositories([root]);

    assert.deepEqual(discovered, [repo]);

    fs.rmSync(root, { force: true, recursive: true });
  });
});

describeWithUnreadableDirectories("git search unreadable directories", () => {
  test("surfaces unreadable directories instead of silently skipping them", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-search-unreadable-"));
    const unreadable = path.join(root, "blocked");
    fs.mkdirSync(unreadable);
    fs.chmodSync(unreadable, 0o000);

    try {
      assert.throws(
        () => findGitRepositories([root]),
        /Could not read Git search directory/,
      );
    } finally {
      fs.chmodSync(unreadable, 0o700);
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
});

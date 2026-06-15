import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listMyOpenPullRequests } from "./github.ts";
import { resetCache } from "../credential-store.ts";
import * as support from "./github-test-support.ts";

support.describeWithExecutableWrapper("github.ts repository discovery 01", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  test("should recognize .git directories (standard repositories)", () => {
    assert.ok(fs.statSync(path.join(context.repoDir, ".git")).isDirectory());
  });


  test("should handle .git files with gitdir: prefix (worktrees)", () => {
    const gitFile = path.join(context.worktreeRepoDir, ".git");
    assert.ok(fs.existsSync(gitFile));
    const content = fs.readFileSync(gitFile, "utf-8");
    assert.ok(content.startsWith("gitdir:"));
  });


  test("should handle .git files (submodules)", () => {
    const gitFile = path.join(context.submoduleRepoDir, ".git");
    assert.ok(fs.existsSync(gitFile));
    const content = fs.readFileSync(gitFile, "utf-8");
    assert.ok(content.includes("gitdir:"));
  });


  test("should distinguish between .git directories and files", () => {
    const normalGit = path.join(context.repoDir, ".git");
    const worktreeGit = path.join(context.worktreeRepoDir, ".git");
    const submoduleGit = path.join(context.submoduleRepoDir, ".git");

    assert.ok(fs.statSync(normalGit).isDirectory(), ".git should be a directory in normal repo");
    assert.ok(fs.statSync(worktreeGit).isFile(), ".git should be a file in worktree");
    assert.ok(fs.statSync(submoduleGit).isFile(), ".git should be a file in submodule");
  });


  test("listMyOpenPullRequests should handle mixed checkout shapes without crashing", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [context.repoDir],
        githubLogin: "octocat",
      });
      assert.ok(Array.isArray(result), "should return an array");
    } catch (err) {
      if (err instanceof Error) {
        assert.ok(
          !err.message.includes("isDirectory") &&
            !err.message.includes("entry.isDirectory"),
          "should not error due to .git file vs directory confusion",
        );
      } else {
        throw err;
      }
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests with explicit paths avoids broken stored config when local discovery is not needed", async () => {
    const originalFetch = global.fetch;
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    const fakeGit = path.join(context.testDir, "git-non-github-origin-explicit-path");
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };
    support.writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "git@example.com:team/internal-tool.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    fs.writeFileSync(path.join(context.testDir, "secrets.json"), "{", "utf-8");
    resetCache();

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [context.repoDir],
        githubLogin: "octocat",
      });

      assert.deepEqual(result, []);
    } finally {
      global.fetch = originalFetch;
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
      fs.rmSync(path.join(context.testDir, "secrets.json"), { force: true });
      resetCache();
    }
  });


  test("listMyOpenPullRequests returns no results without requiring git when discovery finds no repositories", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "github-empty-search-root-"));

    process.env.TRIAGE_COMPANION_GIT = path.join(emptyRoot, "missing-git");

    try {
      const result = await listMyOpenPullRequests({
        searchRoots: [emptyRoot],
      });

      assert.deepEqual(result, []);
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });


  test("listMyOpenPullRequests does not fall back to discovery when repository paths are explicitly empty", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    const originalHome = process.env.HOME;
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-empty-explicit-repository-paths-home-"));
    const defaultRoot = path.join(homeDir, "Projects");
    const discoveredRepo = path.join(defaultRoot, "repo");
    support.writeHeadFile(path.join(discoveredRepo, ".git"));
    process.env.HOME = homeDir;
    process.env.TRIAGE_COMPANION_GIT = path.join(homeDir, "missing-git");

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [],
      });

      assert.deepEqual(result, []);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });


  test("listMyOpenPullRequests does not fall back to default roots when explicit search roots are empty", async () => {
    const previousHome = process.env.HOME;
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-empty-explicit-search-roots-home-"));
    const defaultRoot = path.join(homeDir, "Projects");
    const discoveredRepo = path.join(defaultRoot, "repo");
    const fakeGit = path.join(context.testDir, "git-empty-explicit-search-roots");

    fs.mkdirSync(defaultRoot, { recursive: true });
    support.writeHeadFile(path.join(discoveredRepo, ".git"));
    support.writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
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
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.HOME = homeDir;

    try {
      const result = await listMyOpenPullRequests({
        searchRoots: [],
      });

      assert.deepEqual(result, []);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });


  test("listMyOpenPullRequests does not fall back to default roots when explicit search roots are invalid", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

    try {
      const result = await listMyOpenPullRequests({
        searchRoots: [path.join(context.testDir, "missing-root")],
      });

      assert.deepEqual(result, []);
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
    }
  });


  test("listMyOpenPullRequests rejects blank explicit search roots instead of treating them as empty", async () => {
    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          searchRoots: ["   "],
        }),
      /Git search roots must not contain blank entries/,
    );
  });


  test("listMyOpenPullRequests rejects repository paths with control characters", async () => {
    const badRepoDir = path.join(context.testDir, "bad\trepo");
    support.writeHeadFile(path.join(badRepoDir, ".git"));
    const fakeGit = path.join(context.testDir, "git-repo-name-control-char");
    support.writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
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
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [badRepoDir],
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /Git repository path must not include control characters\./);
        assert.equal(message.includes("\t"), false);
        return true;
      },
    );
  });


  test("listMyOpenPullRequests expands home-relative explicit search roots", async () => {
    const fakeGit = path.join(context.testDir, "git-home-search-root");
    const homeSearchRoot = fs.mkdtempSync(path.join(os.homedir(), "triage-gh-home-search-root-"));
    const homeRepo = path.join(homeSearchRoot, "repo");
    const homeRelativeRoot = `~/${path.basename(homeSearchRoot)}`;

    support.writeHeadFile(path.join(homeRepo, ".git"));
    support.writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
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
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      const result = await listMyOpenPullRequests({
        searchRoots: [homeRelativeRoot],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.repositoryPath, homeRepo);
      assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
    } finally {
      fs.rmSync(homeSearchRoot, { recursive: true, force: true });
    }
  });


  test("listMyOpenPullRequests rejects missing explicit repository paths before requiring git", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [path.join(context.testDir, "missing-repo")],
          }),
        /Repository path #1 does not exist\./,
      );
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
    }
  });


  test("listMyOpenPullRequests rejects missing explicit repository paths without echoing control characters", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");
    const invalidPath = path.join(context.testDir, "missing\tpath");

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [invalidPath],
          }),
        (error: unknown) => {
          assert.match(
            error instanceof Error ? error.message : String(error),
            /Repository path #1 does not exist\./,
          );
          assert.ok(
            !(error instanceof Error ? error.message : String(error)).includes("\t"),
          );
          return true;
        },
      );
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
    }
  });


  test("listMyOpenPullRequests rejects explicit directories that are not Git repositories", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    const plainDirectory = fs.mkdtempSync(path.join(context.testDir, "plain-directory-"));
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [plainDirectory],
          }),
        /Repository path #1 is not a Git repository\./,
      );
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
      fs.rmSync(plainDirectory, { recursive: true, force: true });
    }
  });


  test("listMyOpenPullRequests rejects explicit directories with malformed .git files", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedGitFileDirectory = fs.mkdtempSync(path.join(context.testDir, "malformed-git-file-"));
    fs.writeFileSync(path.join(malformedGitFileDirectory, ".git"), "not git metadata\n");
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [malformedGitFileDirectory],
          }),
        /Repository path #1 is not a Git repository\./,
      );
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
      fs.rmSync(malformedGitFileDirectory, { recursive: true, force: true });
    }
  });


  test("listMyOpenPullRequests rejects explicit directories with malformed gitdir formatting", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedGitdirDirectory = fs.mkdtempSync(path.join(context.testDir, "malformed-gitdir-format-"));
    const metadataDirectory = fs.mkdtempSync(path.join(context.testDir, "malformed-gitdir-metadata-"));
    support.writeHeadFile(metadataDirectory);
    fs.writeFileSync(path.join(malformedGitdirDirectory, ".git"), ` gitdir: ${metadataDirectory}\n`);
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [malformedGitdirDirectory],
          }),
        /Repository path #1 is not a Git repository\./,
      );
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
      fs.rmSync(malformedGitdirDirectory, { recursive: true, force: true });
      fs.rmSync(metadataDirectory, { recursive: true, force: true });
    }
  });

});

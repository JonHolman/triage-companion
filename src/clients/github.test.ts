import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listMyOpenPullRequests, resolveCurrentRepositoryFullName } from "./github.ts";
import { resetCache } from "../credential-store.ts";

const describeWithExecutableWrapper = process.platform === "win32" ? describe.skip : describe;

function writeFakeGitScript(scriptPath: string, body: string): void {
  const normalizedBody = body.startsWith("#!/bin/sh\n")
    ? body.slice("#!/bin/sh\n".length)
    : body;
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo 'git version 2.0.0'
  exit 0
fi
${normalizedBody}`,
  );
}

function writeHeadFile(gitDirectory: string, branch: string = "main"): void {
  fs.mkdirSync(gitDirectory, { recursive: true });
  fs.writeFileSync(path.join(gitDirectory, "HEAD"), `ref: refs/heads/${branch}\n`);
}

describeWithExecutableWrapper("github.ts repository discovery", { concurrency: false }, () => {
  let testDir: string;
  let repoDir: string;
  let worktreeRepoDir: string;
  let submoduleRepoDir: string;
  let worktreeGitDir: string;
  let submoduleGitDir: string;
  let defaultGit: string;
  let previousGit: string | undefined;
  let previousConfigDir: string | undefined;
  let previousToken: string | undefined;
  let previousHome: string | undefined;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-test-"));
    repoDir = path.join(testDir, "normal-repo");
    worktreeRepoDir = path.join(testDir, "worktree-repo");
    submoduleRepoDir = path.join(testDir, "submodule-repo");
    worktreeGitDir = path.join(testDir, "metadata", "worktrees", "branch1");
    submoduleGitDir = path.join(testDir, "parent", ".git", "modules", "submodule");
    previousGit = process.env.TRIAGE_COMPANION_GIT;
    previousConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    previousToken = process.env.GITHUB_TOKEN;
    previousHome = process.env.HOME;
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    resetCache();

    defaultGit = path.join(testDir, "git");
    writeFakeGitScript(defaultGit, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(defaultGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = defaultGit;

    writeHeadFile(path.join(repoDir, ".git"));
    fs.writeFileSync(path.join(repoDir, "test.txt"), "test content");

    writeHeadFile(worktreeGitDir, "worktree");
    fs.mkdirSync(worktreeRepoDir);
    fs.writeFileSync(
      path.join(worktreeRepoDir, ".git"),
      `gitdir: ${worktreeGitDir}\n`,
    );
    fs.writeFileSync(path.join(worktreeRepoDir, "test.txt"), "worktree content");

    writeHeadFile(submoduleGitDir, "submodule");
    fs.mkdirSync(submoduleRepoDir);
    fs.writeFileSync(
      path.join(submoduleRepoDir, ".git"),
      "gitdir: ../parent/.git/modules/submodule\n",
    );
    fs.writeFileSync(path.join(submoduleRepoDir, "test.txt"), "submodule content");
  });

  beforeEach(() => {
    process.env.TRIAGE_COMPANION_GIT = defaultGit;
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    resetCache();
  });

  afterEach(() => {
    process.env.TRIAGE_COMPANION_GIT = defaultGit;
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    resetCache();
  });

  after(() => {
    resetCache();

    if (previousGit === undefined) {
      delete process.env.TRIAGE_COMPANION_GIT;
    } else {
      process.env.TRIAGE_COMPANION_GIT = previousGit;
    }

    if (previousConfigDir === undefined) {
      delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
    } else {
      process.env.TRIAGE_COMPANION_CONFIG_DIR = previousConfigDir;
    }

    if (previousToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousToken;
    }

    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("should recognize .git directories (standard repositories)", () => {
    assert.ok(fs.statSync(path.join(repoDir, ".git")).isDirectory());
  });

  test("should handle .git files with gitdir: prefix (worktrees)", () => {
    const gitFile = path.join(worktreeRepoDir, ".git");
    assert.ok(fs.existsSync(gitFile));
    const content = fs.readFileSync(gitFile, "utf-8");
    assert.ok(content.startsWith("gitdir:"));
  });

  test("should handle .git files (submodules)", () => {
    const gitFile = path.join(submoduleRepoDir, ".git");
    assert.ok(fs.existsSync(gitFile));
    const content = fs.readFileSync(gitFile, "utf-8");
    assert.ok(content.includes("gitdir:"));
  });

  test("should distinguish between .git directories and files", () => {
    const normalGit = path.join(repoDir, ".git");
    const worktreeGit = path.join(worktreeRepoDir, ".git");
    const submoduleGit = path.join(submoduleRepoDir, ".git");

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
        repositoryPaths: [repoDir],
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
    const fakeGit = path.join(testDir, "git-non-github-origin-explicit-path");
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };
    writeFakeGitScript(
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
    fs.writeFileSync(path.join(testDir, "secrets.json"), "{", "utf-8");
    resetCache();

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
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
      fs.rmSync(path.join(testDir, "secrets.json"), { force: true });
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
    writeHeadFile(path.join(discoveredRepo, ".git"));
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
    const fakeGit = path.join(testDir, "git-empty-explicit-search-roots");

    fs.mkdirSync(defaultRoot, { recursive: true });
    writeHeadFile(path.join(discoveredRepo, ".git"));
    writeFakeGitScript(
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
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

    try {
      const result = await listMyOpenPullRequests({
        searchRoots: [path.join(testDir, "missing-root")],
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
    const badRepoDir = path.join(testDir, "bad\trepo");
    writeHeadFile(path.join(badRepoDir, ".git"));
    const fakeGit = path.join(testDir, "git-repo-name-control-char");
    writeFakeGitScript(
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
    const fakeGit = path.join(testDir, "git-home-search-root");
    const homeSearchRoot = fs.mkdtempSync(path.join(os.homedir(), "triage-gh-home-search-root-"));
    const homeRepo = path.join(homeSearchRoot, "repo");
    const homeRelativeRoot = `~/${path.basename(homeSearchRoot)}`;

    writeHeadFile(path.join(homeRepo, ".git"));
    writeFakeGitScript(
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
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [path.join(testDir, "missing-repo")],
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
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");
    const invalidPath = path.join(testDir, "missing\tpath");

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
    const plainDirectory = fs.mkdtempSync(path.join(testDir, "plain-directory-"));
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

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
    const malformedGitFileDirectory = fs.mkdtempSync(path.join(testDir, "malformed-git-file-"));
    fs.writeFileSync(path.join(malformedGitFileDirectory, ".git"), "not git metadata\n");
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

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
    const malformedGitdirDirectory = fs.mkdtempSync(path.join(testDir, "malformed-gitdir-format-"));
    const metadataDirectory = fs.mkdtempSync(path.join(testDir, "malformed-gitdir-metadata-"));
    writeHeadFile(metadataDirectory);
    fs.writeFileSync(path.join(malformedGitdirDirectory, ".git"), ` gitdir: ${metadataDirectory}\n`);
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

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

  test("listMyOpenPullRequests rejects explicit directories with missing gitdir targets", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    const staleGitdirDirectory = fs.mkdtempSync(path.join(testDir, "stale-gitdir-"));
    fs.writeFileSync(
      path.join(staleGitdirDirectory, ".git"),
      `gitdir: ${path.join(staleGitdirDirectory, "missing-gitdir")}\n`,
    );
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [staleGitdirDirectory],
          }),
        /Repository path #1 is not a Git repository\./,
      );
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
      fs.rmSync(staleGitdirDirectory, { recursive: true, force: true });
    }
  });

  test("listMyOpenPullRequests ignores non-GitHub repositories without requiring author identity", async () => {
    const fakeGit = path.join(testDir, "git-non-github-origin-without-identity");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") exit 1 ;;
  *" config --get user.email") exit 1 ;;
  *" remote get-url origin") printf "git@example.com:team/internal-tool.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const result = await listMyOpenPullRequests({
      repositoryPaths: [repoDir],
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests surfaces malformed GitHub origin URLs", async () => {
    const fakeGit = path.join(testDir, "git-malformed-github-origin-for-prs");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://token@github.com/octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
        }),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("listMyOpenPullRequests rejects GitHub origin URLs with surrounding whitespace", async () => {
    const fakeGit = path.join(testDir, "git-whitespace-github-origin-for-prs");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf " git@github.com:octocat/hello-world.git \\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
        }),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });

  test("listMyOpenPullRequests rejects malformed GitHub origin URLs with surrounding whitespace", async () => {
    const fakeGit = path.join(testDir, "git-whitespace-malformed-github-origin-for-prs");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf " git@github.com:octocat/hello-world/extra.git \\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
        }),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });

  test("listMyOpenPullRequests rejects GitHub origin URLs with duplicate path separators", async () => {
    const fakeGit = path.join(testDir, "git-duplicate-slash-github-origin-for-prs");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "git@github.com:octocat//hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
        }),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("listMyOpenPullRequests rejects GitHub origin URLs with dot path segments", async () => {
    const fakeGit = path.join(testDir, "git-dot-segment-github-origin-for-prs");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://github.com/octocat/%2E/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
        }),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("listMyOpenPullRequests rejects GitHub origin URLs with control characters", async () => {
    const fakeGit = path.join(testDir, "git-control-char-github-origin-for-prs");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://git\\thub.com/octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
        }),
      /Git remote origin URL must not include control characters\./,
    );
  });

  test("listMyOpenPullRequests ignores repositories without an origin remote", async () => {
    const fakeGit = path.join(testDir, "git-no-origin-remote-for-prs");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin")
    printf "error: No such remote origin\\n" >&2
    exit 2
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const result = await listMyOpenPullRequests({
      repositoryPaths: [repoDir],
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests surfaces blank GitHub origin URLs", async () => {
    const fakeGit = path.join(testDir, "git-blank-origin-remote-for-prs");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
        }),
      /Git remote origin URL must not be empty/,
    );
  });

  test("listMyOpenPullRequests surfaces git remote lookup failures", async () => {
    const fakeGit = path.join(testDir, "git-bad-origin-config-for-prs");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin")
    printf "fatal: bad config value for 'remote.origin.url'\\n" >&2
    exit 128
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
        }),
      /bad config value for 'remote\.origin\.url'/,
    );
  });

  test("listMyOpenPullRequests surfaces remote ref lookup failures", async () => {
    const fakeGit = path.join(testDir, "git-remote-ref-failure");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*")
    printf "fatal: unable to access remote refs\\n" >&2
    exit 128
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
        }),
      /unable to access remote refs/,
    );
  });

  test("listMyOpenPullRequests ignores GitHub repositories without pull request refs when author identity is unavailable", async () => {
    const fakeGit = path.join(testDir, "git-github-origin-no-pr-refs-without-identity");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") exit 1 ;;
  *" config --get user.email") exit 1 ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") exit 0 ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const result = await listMyOpenPullRequests({
      repositoryPaths: [repoDir],
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests ignores GitHub repositories without matching pull request heads when author identity is unavailable", async () => {
    const fakeGit = path.join(testDir, "git-github-origin-unmatched-pr-refs-without-identity");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") exit 1 ;;
  *" config --get user.email") exit 1 ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/head\\ncccccccccccccccccccccccccccccccccccccccc\\trefs/pull/12/merge\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const result = await listMyOpenPullRequests({
      repositoryPaths: [repoDir],
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests uses repository git identity", async () => {
    const fakeGit = path.join(testDir, "git-local-identity");
    writeFakeGitScript(
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

    const result = await listMyOpenPullRequests({
      repositoryPaths: [repoDir],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
  });

  test("listMyOpenPullRequests disambiguates same-SHA branches by pull request head ref", async () => {
    const fakeGit = path.join(testDir, "git-same-sha-pr-branch-disambiguation");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature-one\\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature-two\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(JSON.stringify({ state: "open", head: { ref: "feature-two" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
      });

      assert.equal(calls, 1);
      assert.deepEqual(
        result.map((pullRequest) => ({
          branch: pullRequest.branch,
          url: pullRequest.url,
        })),
        [
          {
            branch: "feature-two",
            url: "https://github.com/octocat/hello-world/pull/12",
          },
        ],
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests disambiguates same-SHA pull request heads by pull request head ref", async () => {
    const fakeGit = path.join(testDir, "git-same-sha-pr-head-disambiguation");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/34/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\ncccccccccccccccccccccccccccccccccccccccc\\trefs/pull/34/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    const seenURLs: string[] = [];
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      seenURLs.push(url);

      if (url === "https://api.github.com/repos/octocat/hello-world/pulls/12") {
        return new Response(JSON.stringify({ state: "open", head: { ref: "feature" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url === "https://api.github.com/repos/octocat/hello-world/pulls/34") {
        return new Response(JSON.stringify({ state: "open", head: { ref: "other-feature" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected GitHub route: ${url}`);
    };

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
      });

      assert.deepEqual(seenURLs, [
        "https://api.github.com/repos/octocat/hello-world/pulls/12",
        "https://api.github.com/repos/octocat/hello-world/pulls/34",
      ]);
      assert.deepEqual(
        result.map((pullRequest) => ({
          branch: pullRequest.branch,
          url: pullRequest.url,
        })),
        [
          {
            branch: "feature",
            url: "https://github.com/octocat/hello-world/pull/12",
          },
        ],
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests ignores branches listed in JSON env config even when branch names contain commas", async () => {
    const fakeGit = path.join(testDir, "git-ignored-branch-with-comma");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature,one\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = '["feature,one"]';

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
      });

      assert.deepEqual(result, []);
    } finally {
      delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    }
  });

  test("listMyOpenPullRequests allows default branch PRs when ignored branches are explicitly empty", async () => {
    const fakeGit = path.join(testDir, "git-empty-ignored-branches");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/main\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = "[]";

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.branch, "main");
      assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
    } finally {
      delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    }
  });

  test("listMyOpenPullRequests rejects ignored branch entries with surrounding whitespace", async () => {
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = '[" main "]';

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub ignored branch list must contain branch names without surrounding whitespace/,
      );
    } finally {
      delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    }
  });

  test("listMyOpenPullRequests rejects ignored branch JSON with surrounding whitespace", async () => {
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = ' ["main"] ';

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub ignored branch list must not include surrounding whitespace/,
      );
    } finally {
      delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    }
  });

  test("listMyOpenPullRequests rejects ignored branch entries with control characters", async () => {
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = '["fea\\tture"]';

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub ignored branch list must contain branch names without control characters/,
      );
    } finally {
      delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    }
  });

  test("listMyOpenPullRequests ignores duplicate explicit repository paths", async () => {
    const fakeGit = path.join(testDir, "git-local-identity-dedup");
    writeFakeGitScript(
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

    const result = await listMyOpenPullRequests({
      repositoryPaths: [repoDir, repoDir],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
  });

  test("listMyOpenPullRequests does not query GitHub for login when local git identity is available", async () => {
    const fakeGit = path.join(testDir, "git-local-identity-no-login-fetch");
    writeFakeGitScript(
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
    process.env.GITHUB_TOKEN = "test-token";

    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      throw new Error("unexpected network request");
    };

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
      assert.equal(calls, 0);
    } finally {
      global.fetch = originalFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });

  test("listMyOpenPullRequests does not replace a mismatched local git identity with the authenticated GitHub login", async () => {
    const fakeGit = path.join(testDir, "git-local-identity-needs-github-login");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "octocat octocat@users.noreply.github.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.GITHUB_TOKEN = "test-token";

    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      throw new Error("unexpected network request");
    };

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
      });

      assert.equal(result.length, 0);
      assert.equal(calls, 0);
    } finally {
      global.fetch = originalFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });

  test("listMyOpenPullRequests uses the authenticated GitHub login when configured", async () => {
    const fakeGit = path.join(testDir, "git-authenticated-login");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") exit 1 ;;
  *" config --get user.email") exit 1 ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "octocat octocat@users.noreply.github.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.GITHUB_TOKEN = "test-token";

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/user");
      return new Response(JSON.stringify({ login: "octocat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
    } finally {
      global.fetch = originalFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });

  test("listMyOpenPullRequests surfaces git config lookup failures instead of silently falling back to the GitHub login", async () => {
    const fakeGit = path.join(testDir, "git-author-config-failure");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name")
    printf "fatal: bad config value for 'user.name'\\n" >&2
    exit 128
    ;;
  *" config --get user.email") exit 1 ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "octocat octocat@users.noreply.github.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
          githubLogin: "octocat",
        }),
      /bad config value for 'user\.name'/,
    );
  });

  test("listMyOpenPullRequests does not treat whitespace-only git config stderr as a missing value", async () => {
    const fakeGit = path.join(testDir, "git-author-config-whitespace-stderr");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name")
    printf " \\n" >&2
    exit 128
    ;;
  *" config --get user.email") exit 1 ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "octocat octocat@users.noreply.github.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
          githubLogin: "octocat",
        }),
      (error: unknown) => error instanceof Error,
    );
  });

  test("listMyOpenPullRequests rejects git config author values with surrounding whitespace", async () => {
    const fakeGit = path.join(testDir, "git-author-config-whitespace");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf " Repo User \\n" ;;
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
          repositoryPaths: [repoDir],
        }),
      /Git config user\.name in .* must include a valid value/,
    );
  });

  test("listMyOpenPullRequests matches GitHub numeric noreply emails for the configured login", async () => {
    const fakeGit = path.join(testDir, "git-authenticated-login-numeric-noreply");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") exit 1 ;;
  *" config --get user.email") exit 1 ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "octocat 12345+octocat@users.noreply.github.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const result = await listMyOpenPullRequests({
      repositoryPaths: [repoDir],
      githubLogin: "octocat",
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
  });

  test("listMyOpenPullRequests rejects GitHub login overrides with surrounding whitespace before repository discovery", async () => {
    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          searchRoots: [],
          githubLogin: " octocat ",
        }),
      /GitHub login must not include surrounding whitespace/,
    );
  });

  test("listMyOpenPullRequests rejects whitespace-only GitHub login overrides before repository discovery", async () => {
    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          searchRoots: [],
          githubLogin: "   ",
        }),
      /GitHub login is required/,
    );
  });

  test("listMyOpenPullRequests surfaces authenticated login failures when no local identity is available", async () => {
    const fakeGit = path.join(testDir, "git-authenticated-login-failure");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") exit 1 ;;
  *" config --get user.email") exit 1 ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.GITHUB_TOKEN = "test-token";

    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
          }),
        /GitHub API HTTP 401: Bad credentials/,
      );
    } finally {
      global.fetch = originalFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });

  test("listMyOpenPullRequests surfaces authenticated login failures when another GitHub repo still needs inferred identity", async () => {
    const fakeGit = path.join(testDir, "git-authenticated-login-partial-failure");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *"${repoDir}"*" config --get user.name") printf "Repo User\\n" ;;
  *"${repoDir}"*" config --get user.email") printf "repo@example.com\\n" ;;
  *"${repoDir}"*" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *"${repoDir}"*" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *"${repoDir}"*" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *"${repoDir}"*" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *"${repoDir}"*" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *"${worktreeRepoDir}"*" config --get user.name") exit 1 ;;
  *"${worktreeRepoDir}"*" config --get user.email") exit 1 ;;
  *"${worktreeRepoDir}"*" remote get-url origin") printf "git@github.com:octocat/second-repo.git\\n" ;;
  *"${worktreeRepoDir}"*" ls-remote origin refs/heads/*") printf "dddddddddddddddddddddddddddddddddddddddd\\trefs/heads/feature-two\\n" ;;
  *"${worktreeRepoDir}"*" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "dddddddddddddddddddddddddddddddddddddddd\\trefs/pull/34/head\\neeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\\trefs/pull/34/merge\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    process.env.GITHUB_TOKEN = "test-token";

    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir, worktreeRepoDir],
          }),
        /GitHub API HTTP 401: Bad credentials/,
      );
    } finally {
      global.fetch = originalFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });

  test("listMyOpenPullRequests rejects invalid author regexes clearly", async () => {
    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
          authorRegex: "(",
        }),
      /GitHub PR author regex must be a valid regular expression/,
    );
  });

  test("listMyOpenPullRequests rejects empty author regexes clearly", async () => {
    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
          authorRegex: "",
        }),
      /GitHub PR author regex must not be empty/,
    );
  });

  test("listMyOpenPullRequests rejects author regexes with control characters clearly", async () => {
    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [repoDir],
          authorRegex: "repo\t@example\\.com",
        }),
      /GitHub PR author regex must not include control characters/,
    );
  });

  test("listMyOpenPullRequests rejects invalid author regexes before git discovery", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            authorRegex: "(",
          }),
        /GitHub PR author regex must be a valid regular expression/,
      );
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
    }
  });

  test("listMyOpenPullRequests does not match GitHub login substrings inside other authors", async () => {
    const fakeGit = path.join(testDir, "git-login-substring-match");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") exit 1 ;;
  *" config --get user.email") exit 1 ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "samuel samuel@users.noreply.github.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const result = await listMyOpenPullRequests({
      repositoryPaths: [repoDir],
      githubLogin: "sam",
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests rejects malformed pull request refs", async () => {
    const fakeGit = path.join(testDir, "git-malformed-pr-ref");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12abc/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12abc/merge\\n" ;;
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
          repositoryPaths: [repoDir],
        }),
      /Git remote pull request refs must match refs\/pull\/<positive-number>\/\(head\|merge\)\./,
    );
  });

  test("listMyOpenPullRequests rejects non-positive pull request refs", async () => {
    const fakeGit = path.join(testDir, "git-zero-pr-ref");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/0/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/0/merge\\n" ;;
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
          repositoryPaths: [repoDir],
        }),
      /Git remote pull request refs must match refs\/pull\/<positive-number>\/\(head\|merge\)\./,
    );
  });

  test("listMyOpenPullRequests rejects abbreviated remote object IDs", async () => {
    const fakeGit = path.join(testDir, "git-short-object-id");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "abcdef\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "abcdef\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
          }),
        /Git remote ref output must include full object IDs/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects ls-remote output with surrounding whitespace", async () => {
    const fakeGit = path.join(testDir, "git-whitespace-remote-ref-line");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf " aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
          }),
        /Git remote ref output must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects remote refs with unsafe object IDs", async () => {
    const fakeGit = path.join(testDir, "git-unsafe-object-id");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "abc/../../user\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "abc/../../user\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
          }),
        /Git remote ref output must include full object IDs/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects ls-remote lines without a ref separator", async () => {
    const fakeGit = path.join(testDir, "git-missing-remote-ref-separator");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
          }),
        /Git remote ref output lines must contain an object ID and ref separated by a tab/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects non-branch refs from refs/heads output", async () => {
    const fakeGit = path.join(testDir, "git-non-branch-head-ref");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/tags/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
          }),
        /Git remote branch refs must match refs\/heads\/<branch>\./,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("resolveCurrentRepositoryFullName reads the current origin", () => {
    const fakeGit = path.join(testDir, "git-current-origin");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.equal(resolveCurrentRepositoryFullName(repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName accepts scp-style remotes with mixed-case GitHub hostnames", () => {
    const fakeGit = path.join(testDir, "git-current-origin-mixed-case-scp-host");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "git@GitHub.com:octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.equal(resolveCurrentRepositoryFullName(repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName strips trailing git suffixes", () => {
    const fakeGit = path.join(testDir, "git-current-origin-trailing-suffix");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://github.com/octocat/hello-world.git/\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.equal(resolveCurrentRepositoryFullName(repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName supports ported SSH GitHub remotes", () => {
    const fakeGit = path.join(testDir, "git-current-origin-ssh-port");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "ssh://git@github.com:22/octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.equal(resolveCurrentRepositoryFullName(repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName accepts SSH URL remotes with mixed-case GitHub hostnames", () => {
    const fakeGit = path.join(testDir, "git-current-origin-mixed-case-ssh-host");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "ssh://git@GitHub.com/octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.equal(resolveCurrentRepositoryFullName(repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName surfaces malformed HTTPS remotes with explicit ports", () => {
    const fakeGit = path.join(testDir, "git-current-origin-https-port");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://github.com:8443/octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces malformed SSH URL remotes with explicit ports", () => {
    const fakeGit = path.join(testDir, "git-current-origin-ssh-explicit-port");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "ssh://git@github.com:2222/octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces malformed HTTPS remote credentials", () => {
    const fakeGit = path.join(testDir, "git-current-origin-https-userinfo");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://token@github.com/octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(() => resolveCurrentRepositoryFullName(repoDir), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /Git remote origin is not a valid GitHub repository URL\./);
      assert.ok(!message.includes("token@"));
      return true;
    });
  });

  test("resolveCurrentRepositoryFullName rejects GitHub remotes with surrounding whitespace", () => {
    const fakeGit = path.join(testDir, "git-current-origin-whitespace");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf " git@github.com:octocat/hello-world.git \\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });

  test("resolveCurrentRepositoryFullName rejects malformed GitHub remotes with surrounding whitespace", () => {
    const fakeGit = path.join(testDir, "git-current-origin-malformed-whitespace");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf " git@github.com:octocat/hello-world/extra.git \\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });

  test("resolveCurrentRepositoryFullName rejects GitHub remotes with duplicate path separators", () => {
    const fakeGit = path.join(testDir, "git-current-origin-duplicate-slash");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://github.com/octocat//hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName rejects GitHub remotes with dot path segments", () => {
    const fakeGit = path.join(testDir, "git-current-origin-dot-segment");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://github.com/octocat/%2E/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName rejects GitHub remotes with control characters", () => {
    const fakeGit = path.join(testDir, "git-current-origin-control-char");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://git\\thub.com/octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin URL must not include control characters\./,
    );
  });

  test("resolveCurrentRepositoryFullName rejects repository paths with control characters before git lookup", () => {
    assert.throws(
      () => resolveCurrentRepositoryFullName(`${repoDir}\tbad`),
      /Git repository path must not include control characters\./,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces invalid git configuration", () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

    try {
      assert.throws(
        () => resolveCurrentRepositoryFullName(repoDir),
        /TRIAGE_COMPANION_GIT is invalid: must point to an executable path/,
      );
    } finally {
      if (previousConfiguredGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousConfiguredGit;
      }
    }
  });

  test("resolveCurrentRepositoryFullName returns null without a GitHub origin", () => {
    const fakeGit = path.join(testDir, "git-non-github-origin");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "git@example.com:octocat/hello-world.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.equal(resolveCurrentRepositoryFullName(repoDir), null);
  });

  test("resolveCurrentRepositoryFullName returns null when origin remote is missing", () => {
    const fakeGit = path.join(testDir, "git-no-origin-remote");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin")
    printf "error: No such remote origin\\n" >&2
    exit 2
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.equal(resolveCurrentRepositoryFullName(repoDir), null);
  });

  test("resolveCurrentRepositoryFullName surfaces blank GitHub origin URLs", () => {
    const fakeGit = path.join(testDir, "git-blank-origin-remote");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin URL must not be empty/,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces git remote lookup failures", () => {
    const fakeGit = path.join(testDir, "git-bad-origin-config");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin")
    printf "fatal: bad config value for 'remote.origin.url'\\n" >&2
    exit 128
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /bad config value for 'remote\.origin\.url'/,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces GitHub remotes with extra path segments", () => {
    const fakeGit = path.join(testDir, "git-extra-origin-path");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://github.com/octocat/hello-world/path.git\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces remotes with query strings", () => {
    const fakeGit = path.join(testDir, "git-current-origin-query");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://github.com/octocat/hello-world.git?via=mirror\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces remotes with fragments", () => {
    const fakeGit = path.join(testDir, "git-current-origin-fragment");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" remote get-url origin") printf "https://github.com/octocat/hello-world.git#main\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    assert.throws(
      () => resolveCurrentRepositoryFullName(repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("listMyOpenPullRequests checks GitHub API for head-only pull request refs", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *" fetch "*) exit 99 ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(JSON.stringify({
        state: "open",
        head: {
          ref: "feature",
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
        githubLogin: "octocat",
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses missing required head refs", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-missing-head-ref");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(JSON.stringify({
        state: "open",
        head: {},
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects malformed pull request API responses", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-malformed-response");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses missing required state", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-missing-state");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(
        JSON.stringify({
          head: {
            ref: "feature",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses with empty states", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-empty-state");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(
        JSON.stringify({
          state: "",
          head: {
            ref: "feature",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses with whitespace-only states", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-blank-state");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(
        JSON.stringify({
          state: "   ",
          head: {
            ref: "feature",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses with surrounding whitespace in states", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-spaced-state");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(
        JSON.stringify({
          state: " open ",
          head: {
            ref: "feature",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses with unknown states", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-unknown-state");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(
        JSON.stringify({
          state: "draft",
          head: {
            ref: "feature",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses with empty head refs", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-empty-ref");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(
        JSON.stringify({
          state: "open",
          head: {
            ref: "",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses with whitespace-only head refs", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-blank-ref");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(
        JSON.stringify({
          state: "open",
          head: {
            ref: "   ",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses with surrounding whitespace in head refs", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-spaced-ref");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(
        JSON.stringify({
          state: "open",
          head: {
            ref: " feature ",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects pull request API responses with invalid top-level fields", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-invalid-fields");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(JSON.stringify({
        state: "open",
        head: {
          ref: 123,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub pull request response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests surfaces pull request API failures for head-only refs", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-api-failure");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
      return new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub API HTTP 401 while checking pull request #12 in octocat\/hello-world: Bad credentials/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests escapes control characters in pull request fetch failures", async () => {
    const fakeGit = path.join(testDir, "git-head-only-pr-fetch-failure");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("Bad\tcredentials\nretry");
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /Could not look up GitHub pull request #12 in octocat\/hello-world: Bad\\tcredentials, retry/,
          );
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests uses GitHub commit author when local object is missing", async () => {
    const fakeGit = path.join(testDir, "git-missing-object");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    printf "fatal: Not a valid object name aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n" >&2
    exit 128
    ;;
  *" fetch "*) exit 99 ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      return new Response(
        JSON.stringify({
          author: { login: "octocat" },
          commit: { author: { name: "Repo User", email: "repo@example.com" } },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [repoDir],
        githubLogin: "octocat",
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests surfaces GitHub commit API failures when the local object is missing", async () => {
    const fakeGit = path.join(testDir, "git-missing-object-api-failure");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    printf "fatal: Not a valid object name aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n" >&2
    exit 128
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      return new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub API HTTP 401 while loading commit a{40} in octocat\/hello-world: Bad credentials/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests escapes control characters in GitHub commit fetch failures", async () => {
    const fakeGit = path.join(testDir, "git-missing-object-fetch-failure");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    printf "fatal: Not a valid object name aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n" >&2
    exit 128
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("Bad\tcredentials\nretry");
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(
            message,
            /Could not load GitHub commit a{40} in octocat\/hello-world: Bad\\tcredentials, retry/,
          );
          assert.ok(!message.includes("\t"));
          assert.ok(!message.includes("\n"));
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects malformed GitHub commit responses", async () => {
    const fakeGit = path.join(testDir, "git-missing-object-malformed-commit-response");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    printf "fatal: Not a valid object name aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n" >&2
    exit 128
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub commit response must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects GitHub commit responses with invalid top-level fields", async () => {
    const fakeGit = path.join(testDir, "git-missing-object-invalid-commit-fields");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    printf "fatal: Not a valid object name aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n" >&2
    exit 128
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      return new Response(
        JSON.stringify({
          author: { login: "octocat" },
          commit: { author: { name: 123 } },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub commit response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects GitHub commit responses with surrounding whitespace in author identity", async () => {
    const fakeGit = path.join(testDir, "git-missing-object-spaced-commit-fields");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    printf "fatal: Not a valid object name aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n" >&2
    exit 128
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      return new Response(
        JSON.stringify({
          author: { login: " octocat " },
          commit: { author: { name: "Repo User", email: "repo@example.com" } },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub commit response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects GitHub commit responses missing author identity", async () => {
    const fakeGit = path.join(testDir, "git-missing-object-missing-author-identity");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    printf "fatal: Not a valid object name aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n" >&2
    exit 128
    ;;
  *" fetch "*) exit 99 ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      return new Response(
        JSON.stringify({
          author: { login: " " },
          commit: { author: { name: " ", email: "" } },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /GitHub commit response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests surfaces local git log failures instead of falling back to GitHub commit authors", async () => {
    const fakeGit = path.join(testDir, "git-local-log-failure");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    printf "fatal: bad config value for 'log.showSignature'\\n" >&2
    exit 128
    ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
            githubLogin: "octocat",
          }),
        /bad config value for 'log\.showSignature'/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("listMyOpenPullRequests rejects blank local git commit authors instead of silently dropping PRs", async () => {
    const fakeGit = path.join(testDir, "git-local-log-blank-author");
    writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *" config --get user.name") printf "Repo User\\n" ;;
  *" config --get user.email") printf "repo@example.com\\n" ;;
  *" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "\\n" ;;
  *) exit 1 ;;
esac
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("unexpected network request");
    };

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [repoDir],
          }),
        /Git commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa in octocat\/hello-world must include a valid author identity/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

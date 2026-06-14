import assert from "node:assert/strict";
import { before, after, afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listDirtyRepositories } from "./git.ts";

const describeWithExecutableWrapper = process.platform === "win32" ? describe.skip : describe;

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

describeWithExecutableWrapper("git.ts repository discovery", { concurrency: false }, () => {
  let testDir: string;
  let freshRepoDir: string;
  let repoDir: string;
  let worktreeRepoDir: string;
  let submoduleRepoDir: string;
  let worktreeGitDir: string;
  let submoduleGitDir: string;
  let defaultGit: string;
  let previousGit: string | undefined;
  let previousHome: string | undefined;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-test-"));
    freshRepoDir = path.join(testDir, "fresh-repo");
    repoDir = path.join(testDir, "normal-repo");
    worktreeRepoDir = path.join(testDir, "worktree-repo");
    submoduleRepoDir = path.join(testDir, "submodule-repo");
    worktreeGitDir = path.join(testDir, "metadata", "worktrees", "branch1");
    submoduleGitDir = path.join(testDir, "parent", ".git", "modules", "submodule");
    previousGit = process.env.TRIAGE_COMPANION_GIT;
    previousHome = process.env.HOME;

    defaultGit = path.join(testDir, "git");
    writeFakeGitScript(
      defaultGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

    if [ "$1" = "status" ]; then
      case "$(basename "$repo")" in
        fresh-repo)
          printf '## No commits yet on main\\n?? README.md\\n'
          ;;
        normal-repo)
          printf '## feature...origin/feature [ahead 2, behind 1]\\n M src/unstaged.ts\\nA  src/staged.ts\\n?? src/new.ts\\n'
          ;;
    worktree-repo)
      printf '## worktree\\n'
      ;;
    submodule-repo)
      printf '## submodule\\nMM nested/file.ts\\n'
      ;;
    large-repo)
      printf '## feature\\n'
      i=1
      while [ "$i" -le 45 ]; do
        printf ' M src/file-%s.ts\\n' "$i"
        i=$((i + 1))
      done
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = defaultGit;

    writeHeadFile(path.join(freshRepoDir, ".git"));
    fs.writeFileSync(path.join(freshRepoDir, "README.md"), "# fresh repo\n");

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
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  });

  afterEach(() => {
    process.env.TRIAGE_COMPANION_GIT = defaultGit;
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  });

  after(() => {
    if (previousGit === undefined) {
      delete process.env.TRIAGE_COMPANION_GIT;
    } else {
      process.env.TRIAGE_COMPANION_GIT = previousGit;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("lists dirty repositories discovered from .git directories and files", () => {
    const result = listDirtyRepositories({
      maxResults: 10,
      searchRoots: [testDir],
    });

    assert.equal(result.length, 3);

    const fresh = result.find((item) => item.path === freshRepoDir);
    assert.ok(fresh);
    assert.equal(fresh.branch, "main");
    assert.equal(fresh.changedCount, 1);
    assert.equal(fresh.untrackedCount, 1);

    const normal = result.find((item) => item.path === repoDir);
    assert.ok(normal);
    assert.equal(normal.name, "normal-repo");
    assert.equal(normal.branch, "feature");
    assert.equal(normal.changedCount, 3);
    assert.equal(normal.stagedCount, 1);
    assert.equal(normal.unstagedCount, 1);
    assert.equal(normal.untrackedCount, 1);
    assert.equal(normal.aheadCount, 2);
    assert.equal(normal.behindCount, 1);

    const submodule = result.find((item) => item.path === submoduleRepoDir);
    assert.ok(submodule);
    assert.equal(submodule.branch, "submodule");
    assert.equal(submodule.changedCount, 1);
    assert.equal(submodule.stagedCount, 1);
    assert.equal(submodule.unstagedCount, 1);

    assert.equal(result.some((item) => item.path === worktreeRepoDir), false);
  });

  test("honors maxResults after sorting by changed file count", () => {
    const result = listDirtyRepositories({
      maxResults: 1,
      searchRoots: [testDir],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.path, repoDir);
  });

  test("rejects fractional maxResults before slicing results", () => {
    assert.throws(
      () => listDirtyRepositories({
        maxResults: 0.5,
        searchRoots: [testDir],
      }),
      /Git repository limit must be a positive integer/,
    );
  });

  test("forces untracked file reporting instead of honoring repo config", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-untracked-mode-root-"));
    const targetRepo = path.join(root, "target-repo");
    writeHeadFile(path.join(targetRepo, ".git"));

    const fakeGit = path.join(root, "git-untracked-mode");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  has_untracked=0
  for arg in "$@"; do
    if [ "$arg" = "--untracked-files=all" ]; then
      has_untracked=1
    fi
  done
  if [ "$has_untracked" -ne 1 ]; then
    printf 'missing --untracked-files=all for %s\\n' "$repo" >&2
    exit 42
  fi
  printf '## main\\n?? new.txt\\n'
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchRoots: [root],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.untrackedCount, 1);
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("searches repository names before running full git status", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-search-name-root-"));
    const targetRepo = path.join(root, "target-repo");
    const unrelatedRepo = path.join(root, "unrelated-repo");
    const fakeGit = path.join(root, "git-search-name");
    writeHeadFile(path.join(targetRepo, ".git"));
    writeHeadFile(path.join(unrelatedRepo, ".git"));
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
      printf '## main\\n M src/target.ts\\n'
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

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchQuery: "target",
        searchRoots: [root],
      });

      assert.deepEqual(result.map((item) => item.path), [targetRepo]);
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("searches branch names before running full git status", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-search-branch-root-"));
    const targetRepo = path.join(root, "alpha-repo");
    const unrelatedRepo = path.join(root, "beta-repo");
    const fakeGit = path.join(root, "git-search-branch");
    writeHeadFile(path.join(targetRepo, ".git"), "feature-target");
    writeHeadFile(path.join(unrelatedRepo, ".git"));
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    alpha-repo)
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

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchQuery: "feature-target",
        searchRoots: [root],
      });

      assert.deepEqual(result.map((item) => item.path), [targetRepo]);
      assert.equal(result[0]?.branch, "feature-target");
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("searches repository names and branch names together", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-search-union-root-"));
    const branchRepo = path.join(root, "alpha-repo");
    const nameRepo = path.join(root, "target-repo");
    const unrelatedRepo = path.join(root, "beta-repo");
    const fakeGit = path.join(root, "git-search-union");
    writeHeadFile(path.join(branchRepo, ".git"), "feature-target");
    writeHeadFile(path.join(nameRepo, ".git"), "main");
    writeHeadFile(path.join(unrelatedRepo, ".git"), "main");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    alpha-repo)
      printf '## feature-target\\n M src/branch.ts\\n'
      ;;
    target-repo)
      printf '## main\\n M src/name.ts\\n'
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

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchQuery: "target",
        searchRoots: [root],
      });

      assert.deepEqual(
        result.map((item) => item.path).sort(),
        [branchRepo, nameRepo].sort(),
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps full status output for each dirty repository", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-lines-"));
    const largeRepo = path.join(root, "large-repo");
    writeHeadFile(path.join(largeRepo, ".git"));

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchRoots: [root],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.changedCount, 45);
      assert.equal(result[0]?.statusLines.length, 45);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns no repositories without requiring git when discovery finds none", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-empty-search-root-"));
    process.env.TRIAGE_COMPANION_GIT = path.join(emptyRoot, "missing-git");

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchRoots: [emptyRoot],
      });

      assert.deepEqual(result, []);
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  test("returns no repositories without requiring git when explicit search roots are invalid", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchRoots: [path.join(testDir, "missing-root")],
      });

      assert.deepEqual(result, []);
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
    }
  });

  test("rejects repository paths with control characters", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-repo-name-control-char-"));
    const badRepoDir = path.join(tempRoot, "bad\trepo");
    const fakeGit = path.join(tempRoot, "git");
    writeFakeGitScript(
      fakeGit,
      `if [ "$1" = "-C" ]; then
  shift 2
fi

if [ "$1" = "status" ]; then
  printf '## feature\\n M src/file.ts\\n'
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;
    writeHeadFile(path.join(badRepoDir, ".git"));

    try {
      assert.throws(
        () => listDirtyRepositories({ maxResults: 10, searchRoots: [tempRoot] }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /Git repository path must not include control characters\./);
          assert.equal(message.includes("\t"), false);
          return true;
        },
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("rejects blank explicit search roots instead of treating them as empty", () => {
    assert.throws(
      () =>
        listDirtyRepositories({
          maxResults: 10,
          searchRoots: ["   "],
        }),
      /Git search roots must not contain blank entries/,
    );
  });

  test("does not fall back to default roots when explicit search roots are empty", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const originalHome = process.env.HOME;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-empty-explicit-search-roots-"));
    const home = path.join(root, "home");
    const repoRoot = path.join(home, "Projects");
    const discoveredRepo = path.join(repoRoot, "repo");
    const fakeGit = path.join(root, "git-empty-explicit-search-roots");
    writeHeadFile(path.join(discoveredRepo, ".git"));
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    repo)
      printf '## main\\n M src/file.ts\\n'
      ;;
    *)
      printf '## main\\n'
      ;;
  esac
fi
`,
    );
    process.env.HOME = home;
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchRoots: [],
      });

      assert.deepEqual(result, []);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("expands home-relative explicit search roots", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const originalHome = process.env.HOME;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-home-search-root-"));
    const home = path.join(root, "home");
    const repoRoot = path.join(home, "repos");
    const homeRepo = path.join(repoRoot, "repo");
    const fakeGit = path.join(root, "git-home-search-root");
    writeHeadFile(path.join(homeRepo, ".git"));
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    repo)
      printf '## main\\n M src/file.ts\\n'
      ;;
    *)
      printf '## main\\n'
      ;;
  esac
fi
`,
    );
    process.env.HOME = home;
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchRoots: ["~/repos"],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.path, homeRepo);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("preserves valid internal spaces in search root paths", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-search-root-space-"));
    const spacedRoot = path.join(root, "repos space");
    const repo = path.join(spacedRoot, "repo");
    const fakeGit = path.join(root, "git-search-root-space");
    writeHeadFile(path.join(repo, ".git"));
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    repo)
      printf '## main\\n M src/file.ts\\n'
      ;;
    *)
      printf '## main\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchRoots: [spacedRoot],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.path, repo);
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("surfaces git status failures instead of silently dropping repositories", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const failingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-failure-root-"));
    const failingRepo = path.join(failingRoot, "failing-repo");
    writeHeadFile(path.join(failingRepo, ".git"));

    const fakeGit = path.join(failingRoot, "git-status-failure");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    failing-repo)
      printf "fatal: bad config value for 'status.relativePaths'\\n" >&2
      exit 128
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [failingRoot],
          }),
        /bad config value for 'status\.relativePaths'/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(failingRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output missing a branch header", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-malformed-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-malformed");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '\\n M src/file.ts\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output missing branch header/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output whose first line is not a branch header", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-branch-prefix-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-branch-prefix");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf 'main\\n M src/file.ts\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output missing branch header/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with surrounding whitespace in the branch header", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-whitespace-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-whitespace");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '##  main \\n M src/file.ts\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status branch header must not include surrounding whitespace/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with control characters in the branch header", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-control-char-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-control-char");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '## main\\tbranch\\n M src/file.ts\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status branch header must not include control characters/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with malformed ahead counts", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-ahead-count-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-ahead-count");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '## main...origin/main [ahead 2x, behind 1]\\n M src/file.ts\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status branch header must include valid ahead\/behind counts/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with multiple tracking groups", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-tracking-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-tracking");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '## main...origin/main [ahead 1] [behind 2]\\n M src/file.ts\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status branch header must include valid ahead\/behind counts/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with control characters in changed paths", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-path-control-char-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-path-control-char");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '## main\\n M src/file\\tname.ts\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output paths must not include control characters/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with quoted control character escapes in changed paths", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-path-escaped-control-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-path-escaped-control");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '%s\\n' '## main' ' M "src/file\\tname.ts"'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output paths must not include control characters/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with quoted C1 control character escapes in changed paths", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-path-escaped-c1-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-path-escaped-c1");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '%s\\n' '## main' ' M "src/file\\205name.ts"'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output paths must not include control characters/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("accepts git status output with quoted literal backslash escapes in changed paths", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-path-literal-backslash-root-"));
    const repo = path.join(root, "repo");
    writeHeadFile(path.join(repo, ".git"));

    const fakeGit = path.join(root, "git-status-path-literal-backslash");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    repo)
      printf '%s\\n' '## main' ' M "src/file\\\\tname.ts"'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchRoots: [root],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.changedCount, 1);
      assert.match(result[0]?.statusLines[0] ?? "", /file\\\\tname/);
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects git status output with blank status entries", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-blank-entry-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-blank-entry");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '## main\\n   \\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output must not include blank status entries/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with empty status lines", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-empty-line-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-empty-line");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '## main\\n\\n M src/file.ts\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output must not include blank status entries/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with truncated status entries", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-truncated-entry-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-truncated-entry");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '## main\\nM\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output must separate status codes from paths/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with missing changed paths", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-missing-path-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-missing-path");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '## main\\n??  \\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output must include a changed path/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("rejects git status output with invalid status codes", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-invalid-code-root-"));
    const malformedRepo = path.join(malformedRoot, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    const fakeGit = path.join(malformedRoot, "git-status-invalid-code");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    malformed-repo)
      printf '## main\\nZZ bad.txt\\n'
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      assert.throws(
        () =>
          listDirtyRepositories({
            maxResults: 10,
            searchRoots: [malformedRoot],
          }),
        /Git status output must include valid porcelain status codes/,
      );
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  test("handles git status output larger than Node's default exec buffer", () => {
    const previousGit = process.env.TRIAGE_COMPANION_GIT;
    const hugeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-huge-status-root-"));
    const hugeRepo = path.join(hugeRoot, "huge-repo");
    writeHeadFile(path.join(hugeRepo, ".git"));

    const fakeGit = path.join(hugeRoot, "git-huge-status");
    writeFakeGitScript(
      fakeGit,
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    huge-repo)
      printf '## feature\\n'
      i=1
      while [ "$i" -le 70000 ]; do
        printf ' M src/file-%s.ts\\n' "$i"
        i=$((i + 1))
      done
      ;;
  esac
fi
`,
    );
    process.env.TRIAGE_COMPANION_GIT = fakeGit;

    try {
      const result = listDirtyRepositories({
        maxResults: 10,
        searchRoots: [hugeRoot],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.path, hugeRepo);
      assert.equal(result[0]?.changedCount, 70000);
      assert.equal(result[0]?.statusLines.length, 70000);
    } finally {
      if (previousGit === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = previousGit;
      }
      fs.rmSync(hugeRoot, { recursive: true, force: true });
    }
  });
});

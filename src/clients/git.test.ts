import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listDirtyRepositories } from "./git.ts";
import {
  describeWithExecutableWrapper,
  restoreEnvValue,
  statusScriptFor,
  withFakeGit,
  writeFakeGitScript,
  writeHeadFile,
} from "./git-test-support.ts";

describeWithExecutableWrapper("git.ts repository discovery", { concurrency: false }, () => {
  let testDir: string;
  let freshRepoDir: string;
  let repoDir: string;
  let worktreeRepoDir: string;
  let submoduleRepoDir: string;
  let defaultGit: string;
  let previousGit: string | undefined;
  let previousHome: string | undefined;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-test-"));
    freshRepoDir = path.join(testDir, "fresh-repo");
    repoDir = path.join(testDir, "normal-repo");
    worktreeRepoDir = path.join(testDir, "worktree-repo");
    submoduleRepoDir = path.join(testDir, "submodule-repo");
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

    const worktreeGitDir = path.join(testDir, "metadata", "worktrees", "branch1");
    writeHeadFile(worktreeGitDir, "worktree");
    fs.mkdirSync(worktreeRepoDir);
    fs.writeFileSync(path.join(worktreeRepoDir, ".git"), `gitdir: ${worktreeGitDir}\n`);
    fs.writeFileSync(path.join(worktreeRepoDir, "test.txt"), "worktree content");

    const submoduleGitDir = path.join(testDir, "parent", ".git", "modules", "submodule");
    writeHeadFile(submoduleGitDir, "submodule");
    fs.mkdirSync(submoduleRepoDir);
    fs.writeFileSync(path.join(submoduleRepoDir, ".git"), "gitdir: ../parent/.git/modules/submodule\n");
    fs.writeFileSync(path.join(submoduleRepoDir, "test.txt"), "submodule content");
  });

  beforeEach(() => {
    process.env.TRIAGE_COMPANION_GIT = defaultGit;
    restoreEnvValue("HOME", previousHome);
  });

  afterEach(() => {
    process.env.TRIAGE_COMPANION_GIT = defaultGit;
    restoreEnvValue("HOME", previousHome);
  });

  after(() => {
    restoreEnvValue("TRIAGE_COMPANION_GIT", previousGit);
    restoreEnvValue("HOME", previousHome);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("lists dirty repositories discovered from .git directories and files", () => {
    const result = listDirtyRepositories({ maxResults: 10, searchRoots: [testDir] });

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
    const result = listDirtyRepositories({ maxResults: 1, searchRoots: [testDir] });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.path, repoDir);
  });

  test("rejects fractional maxResults before slicing results", () => {
    assert.throws(
      () => listDirtyRepositories({ maxResults: 0.5, searchRoots: [testDir] }),
      /Git repository limit must be a positive integer/,
    );
  });

  test("forces untracked file reporting instead of honoring repo config", () => {
    withFakeGit(
      "git-untracked-mode-root-",
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  for arg in "$@"; do
    if [ "$arg" = "--untracked-files=all" ]; then
      printf '## main\\n?? new.txt\\n'
      exit 0
    fi
  done
  printf 'missing --untracked-files=all for %s\\n' "$repo" >&2
  exit 42
fi
`,
      (root) => {
        const targetRepo = path.join(root, "target-repo");
        writeHeadFile(path.join(targetRepo, ".git"));

        const result = listDirtyRepositories({ maxResults: 10, searchRoots: [root] });

        assert.equal(result.length, 1);
        assert.equal(result[0]?.untrackedCount, 1);
      },
    );
  });

  test("searches repository names before running full git status", () => {
    withFakeGit(
      "git-search-name-root-",
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
      (root) => {
        const targetRepo = path.join(root, "target-repo");
        writeHeadFile(path.join(targetRepo, ".git"));
        writeHeadFile(path.join(root, "unrelated-repo", ".git"));

        const result = listDirtyRepositories({
          maxResults: 10,
          searchQuery: "target",
          searchRoots: [root],
        });

        assert.deepEqual(result.map((item) => item.path), [targetRepo]);
      },
    );
  });

  test("searches branch names before running full git status", () => {
    withFakeGit(
      "git-search-branch-root-",
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
      (root) => {
        const targetRepo = path.join(root, "alpha-repo");
        writeHeadFile(path.join(targetRepo, ".git"), "feature-target");
        writeHeadFile(path.join(root, "beta-repo", ".git"));

        const result = listDirtyRepositories({
          maxResults: 10,
          searchQuery: "feature-target",
          searchRoots: [root],
        });

        assert.deepEqual(result.map((item) => item.path), [targetRepo]);
        assert.equal(result[0]?.branch, "feature-target");
      },
    );
  });

  test("searches repository names and branch names together", () => {
    withFakeGit(
      "git-search-union-root-",
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
      (root) => {
        const branchRepo = path.join(root, "alpha-repo");
        const nameRepo = path.join(root, "target-repo");
        writeHeadFile(path.join(branchRepo, ".git"), "feature-target");
        writeHeadFile(path.join(nameRepo, ".git"), "main");
        writeHeadFile(path.join(root, "beta-repo", ".git"), "main");

        const result = listDirtyRepositories({
          maxResults: 10,
          searchQuery: "target",
          searchRoots: [root],
        });

        assert.deepEqual(result.map((item) => item.path).sort(), [branchRepo, nameRepo].sort());
      },
    );
  });

  test("keeps full status output for each dirty repository", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-lines-"));
    const largeRepo = path.join(root, "large-repo");
    writeHeadFile(path.join(largeRepo, ".git"));

    try {
      const result = listDirtyRepositories({ maxResults: 10, searchRoots: [root] });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.changedCount, 45);
      assert.equal(result[0]?.statusLines.length, 45);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns no repositories without requiring git when discovery finds none", () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-empty-search-root-"));
    process.env.TRIAGE_COMPANION_GIT = path.join(emptyRoot, "missing-git");

    try {
      const result = listDirtyRepositories({ maxResults: 10, searchRoots: [emptyRoot] });

      assert.deepEqual(result, []);
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  test("returns no repositories without requiring git when explicit search roots are invalid", () => {
    process.env.TRIAGE_COMPANION_GIT = path.join(testDir, "missing-git");

    const result = listDirtyRepositories({
      maxResults: 10,
      searchRoots: [path.join(testDir, "missing-root")],
    });

    assert.deepEqual(result, []);
  });

  test("rejects repository paths with control characters", () => {
    withFakeGit(
      "git-repo-name-control-char-",
      `if [ "$1" = "-C" ]; then
  shift 2
fi

if [ "$1" = "status" ]; then
  printf '## feature\\n M src/file.ts\\n'
fi
`,
      (root) => {
        const badRepoDir = path.join(root, "bad\trepo");
        writeHeadFile(path.join(badRepoDir, ".git"));

        assert.throws(
          () => listDirtyRepositories({ maxResults: 10, searchRoots: [root] }),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(message, /Git repository path must not include control characters\./);
            assert.equal(message.includes("\t"), false);
            return true;
          },
        );
      },
    );
  });

  test("rejects blank explicit search roots instead of treating them as empty", () => {
    assert.throws(
      () => listDirtyRepositories({ maxResults: 10, searchRoots: ["   "] }),
      /Git search roots must not contain blank entries/,
    );
  });

  test("does not fall back to default roots when explicit search roots are empty", () => {
    withFakeGit(
      "git-empty-explicit-search-roots-",
      statusScriptFor("repo", "## main\n M src/file.ts"),
      (root) => {
        const originalHome = process.env.HOME;
        const home = path.join(root, "home");
        writeHeadFile(path.join(home, "Projects", "repo", ".git"));
        process.env.HOME = home;

        try {
          const result = listDirtyRepositories({ maxResults: 10, searchRoots: [] });
          assert.deepEqual(result, []);
        } finally {
          restoreEnvValue("HOME", originalHome);
        }
      },
    );
  });

  test("expands home-relative explicit search roots", () => {
    withFakeGit("git-home-search-root-", statusScriptFor("repo", "## main\n M src/file.ts"), (root) => {
      const originalHome = process.env.HOME;
      const home = path.join(root, "home");
      const homeRepo = path.join(home, "repos", "repo");
      writeHeadFile(path.join(homeRepo, ".git"));
      process.env.HOME = home;

      try {
        const result = listDirtyRepositories({ maxResults: 10, searchRoots: ["~/repos"] });
        assert.equal(result.length, 1);
        assert.equal(result[0]?.path, homeRepo);
      } finally {
        restoreEnvValue("HOME", originalHome);
      }
    });
  });

  test("preserves valid internal spaces in search root paths", () => {
    withFakeGit("git-search-root-space-", statusScriptFor("repo", "## main\n M src/file.ts"), (root) => {
      const spacedRoot = path.join(root, "repos space");
      const repo = path.join(spacedRoot, "repo");
      writeHeadFile(path.join(repo, ".git"));

      const result = listDirtyRepositories({ maxResults: 10, searchRoots: [spacedRoot] });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.path, repo);
    });
  });

  test("surfaces git status failures instead of silently dropping repositories", () => {
    withFakeGit(
      "git-status-failure-root-",
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ] && [ "$(basename "$repo")" = "failing-repo" ]; then
  printf "fatal: bad config value for 'status.relativePaths'\\n" >&2
  exit 128
fi
`,
      (root) => {
        writeHeadFile(path.join(root, "failing-repo", ".git"));

        assert.throws(
          () => listDirtyRepositories({ maxResults: 10, searchRoots: [root] }),
          /bad config value for 'status\.relativePaths'/,
        );
      },
    );
  });

});

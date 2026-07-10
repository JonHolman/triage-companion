import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { listDirtyRepositories } from "./git.ts";
import {
  assertStatusRejected,
  describeWithExecutableWrapper,
  statusScriptFor,
  withFakeGit,
  writeHeadFile,
} from "./git-test-support.ts";

describeWithExecutableWrapper("git status output validation", { concurrency: false }, () => {
  const malformedStatusCases: Array<{
    name: string;
    prefix: string;
    status: string;
    expectedError: RegExp;
  }> = [
    {
      name: "rejects git status output missing a branch header",
      prefix: "git-status-malformed-root-",
      status: "\n M src/file.ts",
      expectedError: /Git status output missing branch header/,
    },
    {
      name: "rejects git status output whose first line is not a branch header",
      prefix: "git-status-branch-prefix-root-",
      status: "main\n M src/file.ts",
      expectedError: /Git status output missing branch header/,
    },
    {
      name: "rejects git status output with surrounding whitespace in the branch header",
      prefix: "git-status-whitespace-root-",
      status: "##  main \n M src/file.ts",
      expectedError: /Git status branch header must not include surrounding whitespace/,
    },
    {
      name: "rejects git status output with control characters in the branch header",
      prefix: "git-status-control-char-root-",
      status: "## main\tbranch\n M src/file.ts",
      expectedError: /Git status branch header must not include control characters/,
    },
    {
      name: "rejects git status output with malformed ahead counts",
      prefix: "git-status-ahead-count-root-",
      status: "## main...origin/main [ahead 2x, behind 1]\n M src/file.ts",
      expectedError: /Git status branch header must include valid ahead\/behind counts/,
    },
    {
      name: "rejects git status output with multiple tracking groups",
      prefix: "git-status-tracking-root-",
      status: "## main...origin/main [ahead 1] [behind 2]\n M src/file.ts",
      expectedError: /Git status branch header must include valid ahead\/behind counts/,
    },
    {
      name: "rejects git status output with control characters in changed paths",
      prefix: "git-status-path-control-char-root-",
      status: "## main\n M src/file\tname.ts",
      expectedError: /Git status output paths must not include control characters/,
    },
    {
      name: "rejects git status output with quoted control character escapes in changed paths",
      prefix: "git-status-path-escaped-control-root-",
      status: "## main\n M \"src/file\\tname.ts\"",
      expectedError: /Git status output paths must not include control characters/,
    },
    {
      name: "rejects git status output with quoted C1 control character escapes in changed paths",
      prefix: "git-status-path-escaped-c1-root-",
      status: "## main\n M \"src/file\\205name.ts\"",
      expectedError: /Git status output paths must not include control characters/,
    },
    {
      name: "rejects git status output with quoted UTF-8 encoded C1 control characters in changed paths",
      prefix: "git-status-path-escaped-utf8-c1-root-",
      status: "## main\n M \"src/file\\302\\205name.ts\"",
      expectedError: /Git status output paths must not include control characters/,
    },
    {
      name: "rejects git status output with blank status entries",
      prefix: "git-status-blank-entry-root-",
      status: "## main\n   ",
      expectedError: /Git status output must not include blank status entries/,
    },
    {
      name: "rejects git status output with empty status lines",
      prefix: "git-status-empty-line-root-",
      status: "## main\n\n M src/file.ts",
      expectedError: /Git status output must not include blank status entries/,
    },
    {
      name: "rejects git status output with truncated status entries",
      prefix: "git-status-truncated-entry-root-",
      status: "## main\nM",
      expectedError: /Git status output must separate status codes from paths/,
    },
    {
      name: "rejects git status output with missing changed paths",
      prefix: "git-status-missing-path-root-",
      status: "## main\n??  ",
      expectedError: /Git status output must include a changed path/,
    },
    {
      name: "rejects git status output with invalid status codes",
      prefix: "git-status-invalid-code-root-",
      status: "## main\nZZ bad.txt",
      expectedError: /Git status output must include valid porcelain status codes/,
    },
  ];

  for (const { name, prefix, status, expectedError } of malformedStatusCases) {
    test(name, () => {
      assertStatusRejected(prefix, status, expectedError);
    });
  }

  test("accepts branch names containing closing brackets", () => {
    withFakeGit(
      "git-status-bracket-branch-root-",
      statusScriptFor("repo", "## wip]test...origin/wip]test [ahead 2, behind 1]\n M src/file.ts"),
      (root) => {
        const repo = path.join(root, "repo");
        writeHeadFile(path.join(repo, ".git"));

        const result = listDirtyRepositories({ maxResults: 10, searchRoots: [root] });

        assert.equal(result.length, 1);
        assert.equal(result[0]?.branch, "wip]test");
        assert.equal(result[0]?.aheadCount, 2);
        assert.equal(result[0]?.behindCount, 1);
      },
    );
  });

  test("accepts git status output with quoted UTF-8 octal escapes for non-ASCII paths", () => {
    withFakeGit(
      "git-status-path-utf8-root-",
      statusScriptFor("repo", "## main\n?? \"caf\\303\\251-\\342\\202\\254.txt\""),
      (root) => {
        const repo = path.join(root, "repo");
        writeHeadFile(path.join(repo, ".git"));

        const result = listDirtyRepositories({ maxResults: 10, searchRoots: [root] });

        assert.equal(result.length, 1);
        assert.equal(result[0]?.untrackedCount, 1);
      },
    );
  });

  test("accepts git status output with quoted non-UTF-8 non-control octal bytes", () => {
    withFakeGit(
      "git-status-path-latin1-root-",
      statusScriptFor("repo", "## main\n?? \"caf\\351.txt\""),
      (root) => {
        const repo = path.join(root, "repo");
        writeHeadFile(path.join(repo, ".git"));

        const result = listDirtyRepositories({ maxResults: 10, searchRoots: [root] });

        assert.equal(result.length, 1);
        assert.equal(result[0]?.untrackedCount, 1);
      },
    );
  });

  test("accepts git status output with quoted literal backslash escapes in changed paths", () => {
    withFakeGit(
      "git-status-path-literal-backslash-root-",
      statusScriptFor("repo", "## main\n M \"src/file\\\\tname.ts\""),
      (root) => {
        const repo = path.join(root, "repo");
        writeHeadFile(path.join(repo, ".git"));

        const result = listDirtyRepositories({ maxResults: 10, searchRoots: [root] });

        assert.equal(result.length, 1);
        assert.equal(result[0]?.changedCount, 1);
        assert.match(result[0]?.statusLines[0] ?? "", /file\\\\tname/);
      },
    );
  });

  test("handles git status output larger than Node's default exec buffer", () => {
    withFakeGit(
      "git-huge-status-root-",
      `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ] && [ "$(basename "$repo")" = "huge-repo" ]; then
  printf '## feature\\n'
  i=1
  while [ "$i" -le 70000 ]; do
    printf ' M src/file-%s.ts\\n' "$i"
    i=$((i + 1))
  done
fi
`,
      (root) => {
        const hugeRepo = path.join(root, "huge-repo");
        writeHeadFile(path.join(hugeRepo, ".git"));

        const result = listDirtyRepositories({ maxResults: 10, searchRoots: [root] });

        assert.equal(result.length, 1);
        assert.equal(result[0]?.path, hugeRepo);
        assert.equal(result[0]?.changedCount, 70000);
        assert.equal(result[0]?.statusLines.length, 70000);
      },
    );
  });
});

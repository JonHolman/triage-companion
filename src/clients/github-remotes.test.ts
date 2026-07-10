import assert from "node:assert/strict";
import { test } from "node:test";
import { listMyOpenPullRequests } from "./github.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./github-test-support.ts";

const rejectNetwork = () => {
  throw new Error("unexpected network request");
};

support.describeWithExecutableWrapper("github.ts pull request remotes", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  test("listMyOpenPullRequests ignores non-GitHub repositories without requiring author identity", async () => {
    support.installFakeGit(
      context.testDir,
      "git-non-github-origin-without-identity",
      support.originOnlyGitScript('printf "git@example.com:team/internal-tool.git\\n"'),
    );

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir],
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests surfaces malformed GitHub origin URLs", async () => {
    support.installFakeGit(
      context.testDir,
      "git-malformed-github-origin-for-prs",
      support.originOnlyGitScript('printf "https://token@github.com/octocat/hello-world.git\\n"'),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("listMyOpenPullRequests rejects GitHub origin URLs with surrounding whitespace", async () => {
    support.installFakeGit(
      context.testDir,
      "git-whitespace-github-origin-for-prs",
      support.originOnlyGitScript('printf " git@github.com:octocat/hello-world.git \\n"'),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });

  test("listMyOpenPullRequests rejects malformed GitHub origin URLs with surrounding whitespace", async () => {
    support.installFakeGit(
      context.testDir,
      "git-whitespace-malformed-github-origin-for-prs",
      support.originOnlyGitScript('printf " git@github.com:octocat/hello-world/extra.git \\n"'),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });

  test("listMyOpenPullRequests rejects GitHub origin URLs with duplicate path separators", async () => {
    support.installFakeGit(
      context.testDir,
      "git-duplicate-slash-github-origin-for-prs",
      support.originOnlyGitScript('printf "git@github.com:octocat//hello-world.git\\n"'),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("listMyOpenPullRequests rejects GitHub origin URLs with dot path segments", async () => {
    support.installFakeGit(
      context.testDir,
      "git-dot-segment-github-origin-for-prs",
      support.originOnlyGitScript('printf "https://github.com/octocat/%2E/hello-world.git\\n"'),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("listMyOpenPullRequests rejects GitHub origin URLs with control characters", async () => {
    support.installFakeGit(
      context.testDir,
      "git-control-char-github-origin-for-prs",
      support.originOnlyGitScript('printf "https://git\\thub.com/octocat/hello-world.git\\n"'),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin URL must not include control characters\./,
    );
  });

  test("listMyOpenPullRequests ignores repositories without an origin remote", async () => {
    support.installFakeGit(
      context.testDir,
      "git-no-origin-remote-for-prs",
      support.originOnlyGitScript('printf "error: No such remote origin\\n" >&2; exit 2'),
    );

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir],
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests surfaces blank GitHub origin URLs", async () => {
    support.installFakeGit(
      context.testDir,
      "git-blank-origin-remote-for-prs",
      support.originOnlyGitScript('printf "\\n"'),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin URL must not be empty/,
    );
  });

  test("listMyOpenPullRequests surfaces git remote lookup failures", async () => {
    support.installFakeGit(
      context.testDir,
      "git-bad-origin-config-for-prs",
      support.originOnlyGitScript(
        `printf "fatal: bad config value for 'remote.origin.url'\\n" >&2; exit 128`,
      ),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /bad config value for 'remote\.origin\.url'/,
    );
  });

  test("listMyOpenPullRequests surfaces remote ref lookup failures", async () => {
    support.installFakeGit(
      context.testDir,
      "git-remote-ref-failure",
      support.gitCaseScript([
        ['*" remote get-url origin"', 'printf "git@github.com:octocat/hello-world.git\\n"'],
        [
          '*" ls-remote origin refs/heads/*"',
          'printf "fatal: unable to access remote refs\\n" >&2; exit 128',
        ],
      ]),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /unable to access remote refs/,
    );
  });

  test("listMyOpenPullRequests rejects malformed pull request refs", async () => {
    support.installFakeGit(
      context.testDir,
      "git-malformed-pr-ref",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/pull/*/head refs/pull/*/merge"': `printf "${support.OBJECT_ID_A}\\trefs/pull/12abc/head\\n${support.OBJECT_ID_B}\\trefs/pull/12abc/merge\\n"`,
      }),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git remote pull request refs must match refs\/pull\/<positive-number>\/\(head\|merge\)\./,
    );
  });

  test("listMyOpenPullRequests rejects non-positive pull request refs", async () => {
    support.installFakeGit(
      context.testDir,
      "git-zero-pr-ref",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/pull/*/head refs/pull/*/merge"': `printf "${support.OBJECT_ID_A}\\trefs/pull/0/head\\n${support.OBJECT_ID_B}\\trefs/pull/0/merge\\n"`,
      }),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git remote pull request refs must match refs\/pull\/<positive-number>\/\(head\|merge\)\./,
    );
  });

  test("listMyOpenPullRequests rejects abbreviated remote object IDs", async () => {
    support.installFakeGit(
      context.testDir,
      "git-short-object-id",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/heads/*"': 'printf "abcdef\\trefs/heads/feature\\n"',
        '*" ls-remote origin refs/pull/*/head refs/pull/*/merge"': `printf "abcdef\\trefs/pull/12/head\\n${support.OBJECT_ID_B}\\trefs/pull/12/merge\\n"`,
      }),
    );

    await withMockFetch(rejectNetwork, () =>
      assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [context.repoDir],
          }),
        /Git remote ref output must include full object IDs/,
      ),
    );
  });

  test("listMyOpenPullRequests rejects ls-remote output with surrounding whitespace", async () => {
    support.installFakeGit(
      context.testDir,
      "git-whitespace-remote-ref-line",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/heads/*"': `printf " ${support.OBJECT_ID_A}\\trefs/heads/feature\\n"`,
      }),
    );

    await withMockFetch(rejectNetwork, () =>
      assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [context.repoDir],
          }),
        /Git remote ref output must not include surrounding whitespace/,
      ),
    );
  });

  test("listMyOpenPullRequests rejects remote refs with unsafe object IDs", async () => {
    support.installFakeGit(
      context.testDir,
      "git-unsafe-object-id",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/heads/*"': 'printf "abc/../../user\\trefs/heads/feature\\n"',
        '*" ls-remote origin refs/pull/*/head refs/pull/*/merge"': `printf "abc/../../user\\trefs/pull/12/head\\n${support.OBJECT_ID_B}\\trefs/pull/12/merge\\n"`,
      }),
    );

    await withMockFetch(rejectNetwork, () =>
      assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [context.repoDir],
          }),
        /Git remote ref output must include full object IDs/,
      ),
    );
  });

  test("listMyOpenPullRequests rejects ls-remote lines without a ref separator", async () => {
    support.installFakeGit(
      context.testDir,
      "git-missing-remote-ref-separator",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/heads/*"': `printf "${support.OBJECT_ID_A} refs/heads/feature\\n"`,
      }),
    );

    await withMockFetch(rejectNetwork, () =>
      assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [context.repoDir],
          }),
        /Git remote ref output lines must contain an object ID and ref separated by a tab/,
      ),
    );
  });

  test("listMyOpenPullRequests rejects non-branch refs from refs/heads output", async () => {
    support.installFakeGit(
      context.testDir,
      "git-non-branch-head-ref",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/heads/*"': `printf "${support.OBJECT_ID_A}\\trefs/tags/feature\\n"`,
      }),
    );

    await withMockFetch(rejectNetwork, () =>
      assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [context.repoDir],
          }),
        /Git remote branch refs must match refs\/heads\/<branch>\./,
      ),
    );
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { listMyOpenPullRequests } from "./github.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./github-test-support.ts";

const noIdentityCases = {
  '*" config --get user.name"': "exit 1",
  '*" config --get user.email"': "exit 1",
} as const;

support.describeWithExecutableWrapper("github.ts pull request author identity", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  test("listMyOpenPullRequests ignores GitHub repositories without pull request refs when author identity is unavailable", async () => {
    support.installFakeGit(
      context.testDir,
      "git-github-origin-no-pr-refs-without-identity",
      support.pullRequestGitScript({
        ...noIdentityCases,
        '*" ls-remote origin refs/pull/*/head refs/pull/*/merge"': "exit 0",
        [`*" cat-file -e ${support.OBJECT_ID_A}"`]: "exit 1",
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]: "exit 1",
      }),
    );

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir],
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests ignores GitHub repositories without matching pull request heads when author identity is unavailable", async () => {
    support.installFakeGit(
      context.testDir,
      "git-github-origin-unmatched-pr-refs-without-identity",
      support.pullRequestGitScript({
        ...noIdentityCases,
        '*" ls-remote origin refs/pull/*/head refs/pull/*/merge"': `printf "${support.OBJECT_ID_B}\\trefs/pull/12/head\\n${"c".repeat(40)}\\trefs/pull/12/merge\\n"`,
        [`*" cat-file -e ${support.OBJECT_ID_A}"`]: "exit 1",
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]: "exit 1",
      }),
    );

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir],
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests uses repository git identity", async () => {
    support.installFakeGit(context.testDir, "git-local-identity", support.pullRequestGitScript());

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
  });

  test("listMyOpenPullRequests does not query GitHub for login when local git identity is available", async () => {
    support.installFakeGit(
      context.testDir,
      "git-local-identity-no-login-fetch",
      support.pullRequestGitScript(),
    );
    process.env.GITHUB_TOKEN = "test-token";

    let calls = 0;
    await withMockFetch(
      () => {
        calls += 1;
        throw new Error("unexpected network request");
      },
      async () => {
        const result = await listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        });

        assert.equal(result.length, 1);
        assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
        assert.equal(calls, 0);
      },
    );
  });

  test("listMyOpenPullRequests does not replace a mismatched local git identity with the authenticated GitHub login", async () => {
    support.installFakeGit(
      context.testDir,
      "git-local-identity-needs-github-login",
      support.pullRequestGitScript({
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]:
          'printf "octocat octocat@users.noreply.github.com\\n"',
      }),
    );
    process.env.GITHUB_TOKEN = "test-token";

    let calls = 0;
    await withMockFetch(
      () => {
        calls += 1;
        throw new Error("unexpected network request");
      },
      async () => {
        const result = await listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        });

        assert.equal(result.length, 0);
        assert.equal(calls, 0);
      },
    );
  });

  test("listMyOpenPullRequests uses the authenticated GitHub login when configured", async () => {
    support.installFakeGit(
      context.testDir,
      "git-authenticated-login",
      support.pullRequestGitScript({
        ...noIdentityCases,
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]:
          'printf "octocat octocat@users.noreply.github.com\\n"',
      }),
    );
    process.env.GITHUB_TOKEN = "test-token";

    await withMockFetch(
      routeHandler(
        new Map([
          ["https://api.github.com/user", () => support.jsonResponse({ login: "octocat" })],
        ]),
      ),
      async () => {
        const result = await listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        });

        assert.equal(result.length, 1);
        assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
      },
    );
  });

  test("listMyOpenPullRequests surfaces git config lookup failures instead of silently falling back to the GitHub login", async () => {
    support.installFakeGit(
      context.testDir,
      "git-author-config-failure",
      support.pullRequestGitScript({
        '*" config --get user.name"': `printf "fatal: bad config value for 'user.name'\\n" >&2; exit 128`,
        '*" config --get user.email"': "exit 1",
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]:
          'printf "octocat octocat@users.noreply.github.com\\n"',
      }),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          githubLogin: "octocat",
        }),
      /bad config value for 'user\.name'/,
    );
  });

  test("listMyOpenPullRequests does not treat whitespace-only git config stderr as a missing value", async () => {
    support.installFakeGit(
      context.testDir,
      "git-author-config-whitespace-stderr",
      support.pullRequestGitScript({
        '*" config --get user.name"': 'printf " \\n" >&2; exit 128',
        '*" config --get user.email"': "exit 1",
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]:
          'printf "octocat octocat@users.noreply.github.com\\n"',
      }),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          githubLogin: "octocat",
        }),
      (error: unknown) => error instanceof Error,
    );
  });

  test("listMyOpenPullRequests rejects git config author values with surrounding whitespace", async () => {
    support.installFakeGit(
      context.testDir,
      "git-author-config-whitespace",
      support.pullRequestGitScript({
        '*" config --get user.name"': 'printf " Repo User \\n"',
      }),
    );

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
        }),
      /Git config user\.name in .* must include a valid value/,
    );
  });

  test("listMyOpenPullRequests matches GitHub numeric noreply emails for the configured login", async () => {
    support.installFakeGit(
      context.testDir,
      "git-authenticated-login-numeric-noreply",
      support.pullRequestGitScript({
        ...noIdentityCases,
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]:
          'printf "octocat 12345+octocat@users.noreply.github.com\\n"',
      }),
    );

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir],
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
    support.installFakeGit(
      context.testDir,
      "git-authenticated-login-failure",
      support.pullRequestGitScript({
        ...noIdentityCases,
        [`*" cat-file -e ${support.OBJECT_ID_A}"`]: "exit 1",
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]: "exit 1",
      }),
    );
    process.env.GITHUB_TOKEN = "test-token";

    await withMockFetch(
      () => support.jsonResponse({ message: "Bad credentials" }, 401),
      () =>
        assert.rejects(
          () =>
            listMyOpenPullRequests({
              repositoryPaths: [context.repoDir],
            }),
          /GitHub API HTTP 401: Bad credentials/,
        ),
    );
  });

  test("listMyOpenPullRequests surfaces authenticated login failures when another GitHub repo still needs inferred identity", async () => {
    support.installFakeGit(
      context.testDir,
      "git-authenticated-login-partial-failure",
      support.gitCaseScript([
        [`*"${context.repoDir}"*" config --get user.name"`, 'printf "Repo User\\n"'],
        [`*"${context.repoDir}"*" config --get user.email"`, 'printf "repo@example.com\\n"'],
        [`*"${context.repoDir}"*" remote get-url origin"`, 'printf "git@github.com:octocat/hello-world.git\\n"'],
        [`*"${context.repoDir}"*" ls-remote origin refs/heads/*"`, `printf "${support.OBJECT_ID_A}\\trefs/heads/feature\\n"`],
        [`*"${context.repoDir}"*" ls-remote origin refs/pull/*/head refs/pull/*/merge"`, `printf "${support.OBJECT_ID_A}\\trefs/pull/12/head\\n${support.OBJECT_ID_B}\\trefs/pull/12/merge\\n"`],
        [`*"${context.repoDir}"*" cat-file -e ${support.OBJECT_ID_A}"`, "exit 0"],
        [`*"${context.repoDir}"*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`, 'printf "Repo User repo@example.com\\n"'],
        [`*"${context.worktreeRepoDir}"*" config --get user.name"`, "exit 1"],
        [`*"${context.worktreeRepoDir}"*" config --get user.email"`, "exit 1"],
        [`*"${context.worktreeRepoDir}"*" remote get-url origin"`, 'printf "git@github.com:octocat/second-repo.git\\n"'],
        [`*"${context.worktreeRepoDir}"*" ls-remote origin refs/heads/*"`, `printf "${"d".repeat(40)}\\trefs/heads/feature-two\\n"`],
        [`*"${context.worktreeRepoDir}"*" ls-remote origin refs/pull/*/head refs/pull/*/merge"`, `printf "${"d".repeat(40)}\\trefs/pull/34/head\\n${"e".repeat(40)}\\trefs/pull/34/merge\\n"`],
      ]),
    );
    process.env.GITHUB_TOKEN = "test-token";

    await withMockFetch(
      () => support.jsonResponse({ message: "Bad credentials" }, 401),
      () =>
        assert.rejects(
          () =>
            listMyOpenPullRequests({
              repositoryPaths: [context.repoDir, context.worktreeRepoDir],
            }),
          /GitHub API HTTP 401: Bad credentials/,
        ),
    );
  });

  test("listMyOpenPullRequests rejects invalid author regexes clearly", async () => {
    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          authorRegex: "(",
        }),
      /GitHub PR author regex must be a valid regular expression/,
    );
  });

  test("listMyOpenPullRequests rejects empty author regexes clearly", async () => {
    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          authorRegex: "",
        }),
      /GitHub PR author regex must not be empty/,
    );
  });

  test("listMyOpenPullRequests rejects author regexes with control characters clearly", async () => {
    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          authorRegex: "repo\t@example\\.com",
        }),
      /GitHub PR author regex must not include control characters/,
    );
  });

  test("listMyOpenPullRequests rejects invalid author regexes before git discovery", async () => {
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          authorRegex: "(",
        }),
      /GitHub PR author regex must be a valid regular expression/,
    );
  });

  test("listMyOpenPullRequests does not match GitHub login substrings inside other authors", async () => {
    support.installFakeGit(
      context.testDir,
      "git-login-substring-match",
      support.pullRequestGitScript({
        ...noIdentityCases,
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]:
          'printf "samuel samuel@users.noreply.github.com\\n"',
      }),
    );

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir],
      githubLogin: "sam",
    });

    assert.deepEqual(result, []);
  });
});

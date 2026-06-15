import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { listMyOpenPullRequests } from "./github.ts";
import * as support from "./github-test-support.ts";

support.describeWithExecutableWrapper("github.ts repository discovery 04", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  test("listMyOpenPullRequests rejects git config author values with surrounding whitespace", async () => {
    const fakeGit = path.join(context.testDir, "git-author-config-whitespace");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git config user\.name in .* must include a valid value/,
    );
  });


  test("listMyOpenPullRequests matches GitHub numeric noreply emails for the configured login", async () => {
    const fakeGit = path.join(context.testDir, "git-authenticated-login-numeric-noreply");
    support.writeFakeGitScript(
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
    const fakeGit = path.join(context.testDir, "git-authenticated-login-failure");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
          }),
        /GitHub API HTTP 401: Bad credentials/,
      );
    } finally {
      global.fetch = originalFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });


  test("listMyOpenPullRequests surfaces authenticated login failures when another GitHub repo still needs inferred identity", async () => {
    const fakeGit = path.join(context.testDir, "git-authenticated-login-partial-failure");
    support.writeFakeGitScript(
      fakeGit,
      `#!/bin/sh
case "$*" in
  *"${context.repoDir}"*" config --get user.name") printf "Repo User\\n" ;;
  *"${context.repoDir}"*" config --get user.email") printf "repo@example.com\\n" ;;
  *"${context.repoDir}"*" remote get-url origin") printf "git@github.com:octocat/hello-world.git\\n" ;;
  *"${context.repoDir}"*" ls-remote origin refs/heads/*") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/heads/feature\\n" ;;
  *"${context.repoDir}"*" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\trefs/pull/12/head\\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\trefs/pull/12/merge\\n" ;;
  *"${context.repoDir}"*" cat-file -e aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") exit 0 ;;
  *"${context.repoDir}"*" log -1 --format=%an %ae aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf "Repo User repo@example.com\\n" ;;
  *"${context.worktreeRepoDir}"*" config --get user.name") exit 1 ;;
  *"${context.worktreeRepoDir}"*" config --get user.email") exit 1 ;;
  *"${context.worktreeRepoDir}"*" remote get-url origin") printf "git@github.com:octocat/second-repo.git\\n" ;;
  *"${context.worktreeRepoDir}"*" ls-remote origin refs/heads/*") printf "dddddddddddddddddddddddddddddddddddddddd\\trefs/heads/feature-two\\n" ;;
  *"${context.worktreeRepoDir}"*" ls-remote origin refs/pull/*/head refs/pull/*/merge") printf "dddddddddddddddddddddddddddddddddddddddd\\trefs/pull/34/head\\neeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\\trefs/pull/34/merge\\n" ;;
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
            repositoryPaths: [context.repoDir, context.worktreeRepoDir],
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
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

    try {
      await assert.rejects(
        () =>
          listMyOpenPullRequests({
            repositoryPaths: [context.repoDir],
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
    const fakeGit = path.join(context.testDir, "git-login-substring-match");
    support.writeFakeGitScript(
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
      repositoryPaths: [context.repoDir],
      githubLogin: "sam",
    });

    assert.deepEqual(result, []);
  });


  test("listMyOpenPullRequests rejects malformed pull request refs", async () => {
    const fakeGit = path.join(context.testDir, "git-malformed-pr-ref");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git remote pull request refs must match refs\/pull\/<positive-number>\/\(head\|merge\)\./,
    );
  });


  test("listMyOpenPullRequests rejects non-positive pull request refs", async () => {
    const fakeGit = path.join(context.testDir, "git-zero-pr-ref");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git remote pull request refs must match refs\/pull\/<positive-number>\/\(head\|merge\)\./,
    );
  });


  test("listMyOpenPullRequests rejects abbreviated remote object IDs", async () => {
    const fakeGit = path.join(context.testDir, "git-short-object-id");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
          }),
        /Git remote ref output must include full object IDs/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests rejects ls-remote output with surrounding whitespace", async () => {
    const fakeGit = path.join(context.testDir, "git-whitespace-remote-ref-line");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
          }),
        /Git remote ref output must not include surrounding whitespace/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests rejects remote refs with unsafe object IDs", async () => {
    const fakeGit = path.join(context.testDir, "git-unsafe-object-id");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
          }),
        /Git remote ref output must include full object IDs/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

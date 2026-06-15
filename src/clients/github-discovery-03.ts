import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { listMyOpenPullRequests } from "./github.ts";
import * as support from "./github-test-support.ts";

support.describeWithExecutableWrapper("github.ts repository discovery 03", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  test("listMyOpenPullRequests disambiguates same-SHA pull request heads by pull request head ref", async () => {
    const fakeGit = path.join(context.testDir, "git-same-sha-pr-head-disambiguation");
    support.writeFakeGitScript(
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
        repositoryPaths: [context.repoDir],
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
    const fakeGit = path.join(context.testDir, "git-ignored-branch-with-comma");
    support.writeFakeGitScript(
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
        repositoryPaths: [context.repoDir],
      });

      assert.deepEqual(result, []);
    } finally {
      delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    }
  });


  test("listMyOpenPullRequests allows default branch PRs when ignored branches are explicitly empty", async () => {
    const fakeGit = path.join(context.testDir, "git-empty-ignored-branches");
    support.writeFakeGitScript(
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
        repositoryPaths: [context.repoDir],
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
            repositoryPaths: [context.repoDir],
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
            repositoryPaths: [context.repoDir],
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
            repositoryPaths: [context.repoDir],
            githubLogin: "octocat",
          }),
        /GitHub ignored branch list must contain branch names without control characters/,
      );
    } finally {
      delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    }
  });


  test("listMyOpenPullRequests ignores duplicate explicit repository paths", async () => {
    const fakeGit = path.join(context.testDir, "git-local-identity-dedup");
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

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir, context.repoDir],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
  });


  test("listMyOpenPullRequests does not query GitHub for login when local git identity is available", async () => {
    const fakeGit = path.join(context.testDir, "git-local-identity-no-login-fetch");
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
    process.env.GITHUB_TOKEN = "test-token";

    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      throw new Error("unexpected network request");
    };

    try {
      const result = await listMyOpenPullRequests({
        repositoryPaths: [context.repoDir],
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
    const fakeGit = path.join(context.testDir, "git-local-identity-needs-github-login");
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
        repositoryPaths: [context.repoDir],
      });

      assert.equal(result.length, 0);
      assert.equal(calls, 0);
    } finally {
      global.fetch = originalFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });


  test("listMyOpenPullRequests uses the authenticated GitHub login when configured", async () => {
    const fakeGit = path.join(context.testDir, "git-authenticated-login");
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
        repositoryPaths: [context.repoDir],
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
    } finally {
      global.fetch = originalFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });


  test("listMyOpenPullRequests surfaces git config lookup failures instead of silently falling back to the GitHub login", async () => {
    const fakeGit = path.join(context.testDir, "git-author-config-failure");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
          githubLogin: "octocat",
        }),
      /bad config value for 'user\.name'/,
    );
  });


  test("listMyOpenPullRequests does not treat whitespace-only git config stderr as a missing value", async () => {
    const fakeGit = path.join(context.testDir, "git-author-config-whitespace-stderr");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
          githubLogin: "octocat",
        }),
      (error: unknown) => error instanceof Error,
    );
  });

});

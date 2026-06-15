import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { listMyOpenPullRequests } from "./github.ts";
import * as support from "./github-test-support.ts";

support.describeWithExecutableWrapper("github.ts repository discovery 02", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  test("listMyOpenPullRequests rejects explicit directories with missing gitdir targets", async () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    const staleGitdirDirectory = fs.mkdtempSync(path.join(context.testDir, "stale-gitdir-"));
    fs.writeFileSync(
      path.join(staleGitdirDirectory, ".git"),
      `gitdir: ${path.join(staleGitdirDirectory, "missing-gitdir")}\n`,
    );
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

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
    const fakeGit = path.join(context.testDir, "git-non-github-origin-without-identity");
    support.writeFakeGitScript(
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
      repositoryPaths: [context.repoDir],
    });

    assert.deepEqual(result, []);
  });


  test("listMyOpenPullRequests surfaces malformed GitHub origin URLs", async () => {
    const fakeGit = path.join(context.testDir, "git-malformed-github-origin-for-prs");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });


  test("listMyOpenPullRequests rejects GitHub origin URLs with surrounding whitespace", async () => {
    const fakeGit = path.join(context.testDir, "git-whitespace-github-origin-for-prs");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });


  test("listMyOpenPullRequests rejects malformed GitHub origin URLs with surrounding whitespace", async () => {
    const fakeGit = path.join(context.testDir, "git-whitespace-malformed-github-origin-for-prs");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });


  test("listMyOpenPullRequests rejects GitHub origin URLs with duplicate path separators", async () => {
    const fakeGit = path.join(context.testDir, "git-duplicate-slash-github-origin-for-prs");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });


  test("listMyOpenPullRequests rejects GitHub origin URLs with dot path segments", async () => {
    const fakeGit = path.join(context.testDir, "git-dot-segment-github-origin-for-prs");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });


  test("listMyOpenPullRequests rejects GitHub origin URLs with control characters", async () => {
    const fakeGit = path.join(context.testDir, "git-control-char-github-origin-for-prs");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin URL must not include control characters\./,
    );
  });


  test("listMyOpenPullRequests ignores repositories without an origin remote", async () => {
    const fakeGit = path.join(context.testDir, "git-no-origin-remote-for-prs");
    support.writeFakeGitScript(
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
      repositoryPaths: [context.repoDir],
    });

    assert.deepEqual(result, []);
  });


  test("listMyOpenPullRequests surfaces blank GitHub origin URLs", async () => {
    const fakeGit = path.join(context.testDir, "git-blank-origin-remote-for-prs");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /Git remote origin URL must not be empty/,
    );
  });


  test("listMyOpenPullRequests surfaces git remote lookup failures", async () => {
    const fakeGit = path.join(context.testDir, "git-bad-origin-config-for-prs");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /bad config value for 'remote\.origin\.url'/,
    );
  });


  test("listMyOpenPullRequests surfaces remote ref lookup failures", async () => {
    const fakeGit = path.join(context.testDir, "git-remote-ref-failure");
    support.writeFakeGitScript(
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
          repositoryPaths: [context.repoDir],
        }),
      /unable to access remote refs/,
    );
  });


  test("listMyOpenPullRequests ignores GitHub repositories without pull request refs when author identity is unavailable", async () => {
    const fakeGit = path.join(context.testDir, "git-github-origin-no-pr-refs-without-identity");
    support.writeFakeGitScript(
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
      repositoryPaths: [context.repoDir],
    });

    assert.deepEqual(result, []);
  });


  test("listMyOpenPullRequests ignores GitHub repositories without matching pull request heads when author identity is unavailable", async () => {
    const fakeGit = path.join(context.testDir, "git-github-origin-unmatched-pr-refs-without-identity");
    support.writeFakeGitScript(
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
      repositoryPaths: [context.repoDir],
    });

    assert.deepEqual(result, []);
  });


  test("listMyOpenPullRequests uses repository git identity", async () => {
    const fakeGit = path.join(context.testDir, "git-local-identity");
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
      repositoryPaths: [context.repoDir],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
  });


  test("listMyOpenPullRequests disambiguates same-SHA branches by pull request head ref", async () => {
    const fakeGit = path.join(context.testDir, "git-same-sha-pr-branch-disambiguation");
    support.writeFakeGitScript(
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
        repositoryPaths: [context.repoDir],
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

});

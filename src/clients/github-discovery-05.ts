import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { listMyOpenPullRequests, resolveCurrentRepositoryFullName } from "./github.ts";
import * as support from "./github-test-support.ts";

support.describeWithExecutableWrapper("github.ts repository discovery 05", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  test("listMyOpenPullRequests rejects ls-remote lines without a ref separator", async () => {
    const fakeGit = path.join(context.testDir, "git-missing-remote-ref-separator");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
          }),
        /Git remote ref output lines must contain an object ID and ref separated by a tab/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests rejects non-branch refs from refs/heads output", async () => {
    const fakeGit = path.join(context.testDir, "git-non-branch-head-ref");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
          }),
        /Git remote branch refs must match refs\/heads\/<branch>\./,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("resolveCurrentRepositoryFullName reads the current origin", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin");
    support.writeFakeGitScript(
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

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });


  test("resolveCurrentRepositoryFullName accepts scp-style remotes with mixed-case GitHub hostnames", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-mixed-case-scp-host");
    support.writeFakeGitScript(
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

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });


  test("resolveCurrentRepositoryFullName strips trailing git suffixes", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-trailing-suffix");
    support.writeFakeGitScript(
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

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });


  test("resolveCurrentRepositoryFullName supports ported SSH GitHub remotes", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-ssh-port");
    support.writeFakeGitScript(
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

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });


  test("resolveCurrentRepositoryFullName accepts SSH URL remotes with mixed-case GitHub hostnames", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-mixed-case-ssh-host");
    support.writeFakeGitScript(
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

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });


  test("resolveCurrentRepositoryFullName surfaces malformed HTTPS remotes with explicit ports", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-https-port");
    support.writeFakeGitScript(
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
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });


  test("resolveCurrentRepositoryFullName surfaces malformed SSH URL remotes with explicit ports", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-ssh-explicit-port");
    support.writeFakeGitScript(
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
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });


  test("resolveCurrentRepositoryFullName surfaces malformed HTTPS remote credentials", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-https-userinfo");
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

    assert.throws(() => resolveCurrentRepositoryFullName(context.repoDir), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /Git remote origin is not a valid GitHub repository URL\./);
      assert.ok(!message.includes("token@"));
      return true;
    });
  });


  test("resolveCurrentRepositoryFullName rejects GitHub remotes with surrounding whitespace", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-whitespace");
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

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });


  test("resolveCurrentRepositoryFullName rejects malformed GitHub remotes with surrounding whitespace", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-malformed-whitespace");
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

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });


  test("resolveCurrentRepositoryFullName rejects GitHub remotes with duplicate path separators", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-duplicate-slash");
    support.writeFakeGitScript(
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
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });


  test("resolveCurrentRepositoryFullName rejects GitHub remotes with dot path segments", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-dot-segment");
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

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });


  test("resolveCurrentRepositoryFullName rejects GitHub remotes with control characters", () => {
    const fakeGit = path.join(context.testDir, "git-current-origin-control-char");
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

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin URL must not include control characters\./,
    );
  });


  test("resolveCurrentRepositoryFullName rejects repository paths with control characters before git lookup", () => {
    assert.throws(
      () => resolveCurrentRepositoryFullName(`${context.repoDir}\tbad`),
      /Git repository path must not include control characters\./,
    );
  });


  test("resolveCurrentRepositoryFullName surfaces invalid git configuration", () => {
    const previousConfiguredGit = process.env.TRIAGE_COMPANION_GIT;
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

    try {
      assert.throws(
        () => resolveCurrentRepositoryFullName(context.repoDir),
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
    const fakeGit = path.join(context.testDir, "git-non-github-origin");
    support.writeFakeGitScript(
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

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), null);
  });


  test("resolveCurrentRepositoryFullName returns null when origin remote is missing", () => {
    const fakeGit = path.join(context.testDir, "git-no-origin-remote");
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

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), null);
  });


  test("resolveCurrentRepositoryFullName surfaces blank GitHub origin URLs", () => {
    const fakeGit = path.join(context.testDir, "git-blank-origin-remote");
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

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin URL must not be empty/,
    );
  });


  test("resolveCurrentRepositoryFullName surfaces git remote lookup failures", () => {
    const fakeGit = path.join(context.testDir, "git-bad-origin-config");
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

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /bad config value for 'remote\.origin\.url'/,
    );
  });

});

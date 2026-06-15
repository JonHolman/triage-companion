import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { listMyOpenPullRequests } from "./github.ts";
import * as support from "./github-test-support.ts";

support.describeWithExecutableWrapper("github.ts repository discovery 08", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  test("listMyOpenPullRequests surfaces GitHub commit API failures when the local object is missing", async () => {
    const fakeGit = path.join(context.testDir, "git-missing-object-api-failure");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
            githubLogin: "octocat",
          }),
        /GitHub API HTTP 401 while loading commit a{40} in octocat\/hello-world: Bad credentials/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests escapes control characters in GitHub commit fetch failures", async () => {
    const fakeGit = path.join(context.testDir, "git-missing-object-fetch-failure");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
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
    const fakeGit = path.join(context.testDir, "git-missing-object-malformed-commit-response");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
            githubLogin: "octocat",
          }),
        /GitHub commit response must be an object/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests rejects GitHub commit responses with invalid top-level fields", async () => {
    const fakeGit = path.join(context.testDir, "git-missing-object-invalid-commit-fields");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
            githubLogin: "octocat",
          }),
        /GitHub commit response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests rejects GitHub commit responses with surrounding whitespace in author identity", async () => {
    const fakeGit = path.join(context.testDir, "git-missing-object-spaced-commit-fields");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
            githubLogin: "octocat",
          }),
        /GitHub commit response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests rejects GitHub commit responses missing author identity", async () => {
    const fakeGit = path.join(context.testDir, "git-missing-object-missing-author-identity");
    support.writeFakeGitScript(
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
            repositoryPaths: [context.repoDir],
            githubLogin: "octocat",
          }),
        /GitHub commit response must be an object with valid top-level fields/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests surfaces local git log failures instead of falling back to GitHub commit authors", async () => {
    const fakeGit = path.join(context.testDir, "git-local-log-failure");
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
            repositoryPaths: [context.repoDir],
            githubLogin: "octocat",
          }),
        /bad config value for 'log\.showSignature'/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("listMyOpenPullRequests rejects blank local git commit authors instead of silently dropping PRs", async () => {
    const fakeGit = path.join(context.testDir, "git-local-log-blank-author");
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
            repositoryPaths: [context.repoDir],
          }),
        /Git commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa in octocat\/hello-world must include a valid author identity/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

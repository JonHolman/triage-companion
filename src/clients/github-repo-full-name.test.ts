import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { resolveCurrentRepositoryFullName } from "./github.ts";
import * as support from "./github-test-support.ts";

support.describeWithExecutableWrapper("github.ts current repository full name", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  function installOrigin(gitName: string, originAction: string): void {
    support.installFakeGit(context.testDir, gitName, support.originOnlyGitScript(originAction));
  }

  test("resolveCurrentRepositoryFullName reads the current origin", () => {
    installOrigin("git-current-origin", 'printf "git@github.com:octocat/hello-world.git\\n"');

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName accepts scp-style remotes with mixed-case GitHub hostnames", () => {
    installOrigin(
      "git-current-origin-mixed-case-scp-host",
      'printf "git@GitHub.com:octocat/hello-world.git\\n"',
    );

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName strips trailing git suffixes", () => {
    installOrigin(
      "git-current-origin-trailing-suffix",
      'printf "https://github.com/octocat/hello-world.git/\\n"',
    );

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName supports ported SSH GitHub remotes", () => {
    installOrigin(
      "git-current-origin-ssh-port",
      'printf "ssh://git@github.com:22/octocat/hello-world.git\\n"',
    );

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName accepts SSH URL remotes with mixed-case GitHub hostnames", () => {
    installOrigin(
      "git-current-origin-mixed-case-ssh-host",
      'printf "ssh://git@GitHub.com/octocat/hello-world.git\\n"',
    );

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), "octocat/hello-world");
  });

  test("resolveCurrentRepositoryFullName surfaces malformed HTTPS remotes with explicit ports", () => {
    installOrigin(
      "git-current-origin-https-port",
      'printf "https://github.com:8443/octocat/hello-world.git\\n"',
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces malformed SSH URL remotes with explicit ports", () => {
    installOrigin(
      "git-current-origin-ssh-explicit-port",
      'printf "ssh://git@github.com:2222/octocat/hello-world.git\\n"',
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces malformed HTTPS remote credentials", () => {
    installOrigin(
      "git-current-origin-https-userinfo",
      'printf "https://token@github.com/octocat/hello-world.git\\n"',
    );

    assert.throws(() => resolveCurrentRepositoryFullName(context.repoDir), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /Git remote origin is not a valid GitHub repository URL\./);
      assert.ok(!message.includes("token@"));
      return true;
    });
  });

  test("resolveCurrentRepositoryFullName rejects GitHub remotes with surrounding whitespace", () => {
    installOrigin(
      "git-current-origin-whitespace",
      'printf " git@github.com:octocat/hello-world.git \\n"',
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });

  test("resolveCurrentRepositoryFullName rejects malformed GitHub remotes with surrounding whitespace", () => {
    installOrigin(
      "git-current-origin-malformed-whitespace",
      'printf " git@github.com:octocat/hello-world/extra.git \\n"',
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin URL must not include surrounding whitespace/,
    );
  });

  test("resolveCurrentRepositoryFullName rejects GitHub remotes with duplicate path separators", () => {
    installOrigin(
      "git-current-origin-duplicate-slash",
      'printf "https://github.com/octocat//hello-world.git\\n"',
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName rejects GitHub remotes with dot path segments", () => {
    installOrigin(
      "git-current-origin-dot-segment",
      'printf "https://github.com/octocat/%2E/hello-world.git\\n"',
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName rejects GitHub remotes with control characters", () => {
    installOrigin(
      "git-current-origin-control-char",
      'printf "https://git\\thub.com/octocat/hello-world.git\\n"',
    );

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
    process.env.TRIAGE_COMPANION_GIT = path.join(context.testDir, "missing-git");

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /TRIAGE_COMPANION_GIT is invalid: must point to an executable path/,
    );
  });

  test("resolveCurrentRepositoryFullName returns null without a GitHub origin", () => {
    installOrigin("git-non-github-origin", 'printf "git@example.com:octocat/hello-world.git\\n"');

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), null);
  });

  test("resolveCurrentRepositoryFullName returns null when origin remote is missing", () => {
    installOrigin("git-no-origin-remote", 'printf "error: No such remote origin\\n" >&2; exit 2');

    assert.equal(resolveCurrentRepositoryFullName(context.repoDir), null);
  });

  test("resolveCurrentRepositoryFullName surfaces blank GitHub origin URLs", () => {
    installOrigin("git-blank-origin-remote", 'printf "\\n"');

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin URL must not be empty/,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces git remote lookup failures", () => {
    installOrigin(
      "git-bad-origin-config",
      `printf "fatal: bad config value for 'remote.origin.url'\\n" >&2; exit 128`,
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /bad config value for 'remote\.origin\.url'/,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces GitHub remotes with extra path segments", () => {
    installOrigin(
      "git-extra-origin-path",
      'printf "https://github.com/octocat/hello-world/path.git\\n"',
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces remotes with query strings", () => {
    installOrigin(
      "git-current-origin-query",
      'printf "https://github.com/octocat/hello-world.git?via=mirror\\n"',
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });

  test("resolveCurrentRepositoryFullName surfaces remotes with fragments", () => {
    installOrigin(
      "git-current-origin-fragment",
      'printf "https://github.com/octocat/hello-world.git#main\\n"',
    );

    assert.throws(
      () => resolveCurrentRepositoryFullName(context.repoDir),
      /Git remote origin is not a valid GitHub repository URL\./,
    );
  });
});

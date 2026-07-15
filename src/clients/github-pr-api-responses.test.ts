import assert from "node:assert/strict";
import { test } from "node:test";
import { listMyOpenPullRequests } from "./github.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./github-test-support.ts";

const PULL_12_URL = "https://api.github.com/repos/octocat/hello-world/pulls/12";

const headOnlyPullScript = (overrides: Readonly<Record<string, string>> = {}) =>
  support.pullRequestGitScript({
    '*" ls-remote origin refs/pull/*/head refs/pull/*/merge"': `printf "${support.OBJECT_ID_A}\\trefs/pull/12/head\\n"`,
    ...overrides,
  });

support.describeWithExecutableWrapper("github.ts pull request API responses", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  async function rejectsPullResponse(
    gitName: string,
    body: unknown,
    pattern: RegExp,
  ): Promise<void> {
    support.installFakeGit(context.testDir, gitName, headOnlyPullScript());

    await withMockFetch(
      routeHandler(new Map([[PULL_12_URL, () => support.jsonResponse(body)]])),
      () =>
        assert.rejects(
          () =>
            listMyOpenPullRequests({
              repositoryPaths: [context.repoDir],
              githubLogin: "octocat",
            }),
          pattern,
        ),
    );
  }

  test("listMyOpenPullRequests checks GitHub API for head-only pull request refs", async () => {
    support.installFakeGit(
      context.testDir,
      "git-head-only-pr",
      headOnlyPullScript({ '*" fetch "*': "exit 99" }),
    );

    await withMockFetch(
      routeHandler(
        new Map([
          [PULL_12_URL, () => support.jsonResponse({ state: "open", head: { ref: "feature" } })],
        ]),
      ),
      async () => {
        const result = await listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          githubLogin: "octocat",
        });

        assert.equal(result.length, 1);
        assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
      },
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses missing required head refs", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-missing-head-ref",
      { state: "open", head: {} },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects malformed pull request API responses", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-malformed-response",
      [],
      /GitHub pull request response must be an object/,
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses missing required state", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-missing-state",
      { head: { ref: "feature" } },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses with empty states", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-empty-state",
      { state: "", head: { ref: "feature" } },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses with whitespace-only states", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-blank-state",
      { state: "   ", head: { ref: "feature" } },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses with surrounding whitespace in states", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-spaced-state",
      { state: " open ", head: { ref: "feature" } },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses with unknown states", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-unknown-state",
      { state: "draft", head: { ref: "feature" } },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses with empty head refs", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-empty-ref",
      { state: "open", head: { ref: "" } },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses with whitespace-only head refs", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-blank-ref",
      { state: "open", head: { ref: "   " } },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses with surrounding whitespace in head refs", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-spaced-ref",
      { state: "open", head: { ref: " feature " } },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects pull request API responses with invalid top-level fields", async () => {
    await rejectsPullResponse(
      "git-head-only-pr-invalid-fields",
      { state: "open", head: { ref: 123 } },
      /GitHub pull request response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests surfaces pull request API failures for head-only refs", async () => {
    support.installFakeGit(
      context.testDir,
      "git-head-only-pr-api-failure",
      headOnlyPullScript(),
    );

    await withMockFetch(
      routeHandler(
        new Map([[PULL_12_URL, () => support.jsonResponse({ message: "Bad credentials" }, 401)]]),
      ),
      () =>
        assert.rejects(
          () =>
            listMyOpenPullRequests({
              repositoryPaths: [context.repoDir],
              githubLogin: "octocat",
            }),
          /GitHub API HTTP 401 while checking pull request #12 in octocat\/hello-world: Bad credentials/,
        ),
    );
  });

  test("listMyOpenPullRequests explains pull request API permission failures", async () => {
    support.installFakeGit(
      context.testDir,
      "git-head-only-pr-api-permission-failure",
      headOnlyPullScript(),
    );

    await withMockFetch(
      routeHandler(
        new Map([
          [
            PULL_12_URL,
            () =>
              support.jsonResponse(
                { message: " Resource not accessible by personal access token\n" },
                403,
              ),
          ],
        ]),
      ),
      () =>
        assert.rejects(
          () =>
            listMyOpenPullRequests({
              repositoryPaths: [context.repoDir],
              githubLogin: "octocat",
            }),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(
              message,
              /GitHub API HTTP 403 while checking pull request #12 in octocat\/hello-world: Resource not accessible by personal access token/,
            );
            assert.match(message, /GitHub token being used cannot read this repository's pull requests/);
            assert.match(message, /narrow Git search roots/);
            assert.ok(!message.includes("\n"));
            return true;
          },
        ),
    );
  });

  test("listMyOpenPullRequests escapes control characters in pull request fetch failures", async () => {
    support.installFakeGit(
      context.testDir,
      "git-head-only-pr-fetch-failure",
      headOnlyPullScript(),
    );

    await withMockFetch(
      () => {
        throw new Error("Bad\tcredentials\nretry");
      },
      () =>
        assert.rejects(
          () =>
            listMyOpenPullRequests({
              repositoryPaths: [context.repoDir],
              githubLogin: "octocat",
            }),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(
              message,
              /Could not look up GitHub pull request #12 in octocat\/hello-world: Bad\\tcredentials, retry/,
            );
            assert.ok(!message.includes("\t"));
            assert.ok(!message.includes("\n"));
            return true;
          },
        ),
    );
  });
});

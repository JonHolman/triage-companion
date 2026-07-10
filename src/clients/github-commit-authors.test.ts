import assert from "node:assert/strict";
import { test } from "node:test";
import { listMyOpenPullRequests } from "./github.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./github-test-support.ts";

const COMMIT_URL = `https://api.github.com/repos/octocat/hello-world/commits/${support.OBJECT_ID_A}`;

const missingObjectScript = (overrides: Readonly<Record<string, string>> = {}) =>
  support.pullRequestGitScript({
    [`*" cat-file -e ${support.OBJECT_ID_A}"`]:
      `printf "fatal: Not a valid object name ${support.OBJECT_ID_A}\\n" >&2; exit 128`,
    [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]: "exit 1",
    ...overrides,
  });

support.describeWithExecutableWrapper("github.ts commit author resolution", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  async function rejectsCommitResponse(
    gitName: string,
    script: string,
    body: unknown,
    status: number,
    pattern: RegExp,
  ): Promise<void> {
    support.installFakeGit(context.testDir, gitName, script);

    await withMockFetch(
      routeHandler(new Map([[COMMIT_URL, () => support.jsonResponse(body, status)]])),
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

  test("listMyOpenPullRequests uses GitHub commit author when local object is missing", async () => {
    support.installFakeGit(
      context.testDir,
      "git-missing-object",
      missingObjectScript({ '*" fetch "*': "exit 99" }),
    );

    await withMockFetch(
      routeHandler(
        new Map([
          [
            COMMIT_URL,
            () =>
              support.jsonResponse({
                author: { login: "octocat" },
                commit: { author: { name: "Repo User", email: "repo@example.com" } },
              }),
          ],
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

  test("listMyOpenPullRequests surfaces GitHub commit API failures when the local object is missing", async () => {
    await rejectsCommitResponse(
      "git-missing-object-api-failure",
      missingObjectScript(),
      { message: "Bad credentials" },
      401,
      /GitHub API HTTP 401 while loading commit a{40} in octocat\/hello-world: Bad credentials/,
    );
  });

  test("listMyOpenPullRequests escapes control characters in GitHub commit fetch failures", async () => {
    support.installFakeGit(
      context.testDir,
      "git-missing-object-fetch-failure",
      missingObjectScript(),
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
              /Could not load GitHub commit a{40} in octocat\/hello-world: Bad\\tcredentials, retry/,
            );
            assert.ok(!message.includes("\t"));
            assert.ok(!message.includes("\n"));
            return true;
          },
        ),
    );
  });

  test("listMyOpenPullRequests rejects malformed GitHub commit responses", async () => {
    await rejectsCommitResponse(
      "git-missing-object-malformed-commit-response",
      missingObjectScript(),
      [],
      200,
      /GitHub commit response must be an object/,
    );
  });

  test("listMyOpenPullRequests rejects GitHub commit responses with invalid top-level fields", async () => {
    await rejectsCommitResponse(
      "git-missing-object-invalid-commit-fields",
      missingObjectScript(),
      { author: { login: "octocat" }, commit: { author: { name: 123 } } },
      200,
      /GitHub commit response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects GitHub commit responses with surrounding whitespace in author identity", async () => {
    await rejectsCommitResponse(
      "git-missing-object-spaced-commit-fields",
      missingObjectScript(),
      {
        author: { login: " octocat " },
        commit: { author: { name: "Repo User", email: "repo@example.com" } },
      },
      200,
      /GitHub commit response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests rejects GitHub commit responses missing author identity", async () => {
    await rejectsCommitResponse(
      "git-missing-object-missing-author-identity",
      missingObjectScript({ '*" fetch "*': "exit 99" }),
      { author: { login: " " }, commit: { author: { name: " ", email: "" } } },
      200,
      /GitHub commit response must be an object with valid top-level fields/,
    );
  });

  test("listMyOpenPullRequests surfaces local git log failures instead of falling back to GitHub commit authors", async () => {
    support.installFakeGit(
      context.testDir,
      "git-local-log-failure",
      support.pullRequestGitScript({
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]:
          `printf "fatal: bad config value for 'log.showSignature'\\n" >&2; exit 128`,
      }),
    );

    await withMockFetch(
      () => {
        throw new Error("unexpected network request");
      },
      () =>
        assert.rejects(
          () =>
            listMyOpenPullRequests({
              repositoryPaths: [context.repoDir],
              githubLogin: "octocat",
            }),
          /bad config value for 'log\.showSignature'/,
        ),
    );
  });

  test("listMyOpenPullRequests rejects blank local git commit authors instead of silently dropping PRs", async () => {
    support.installFakeGit(
      context.testDir,
      "git-local-log-blank-author",
      support.pullRequestGitScript({
        [`*" log -1 --format=%an %ae ${support.OBJECT_ID_A}"`]: 'printf "\\n"',
      }),
    );

    await withMockFetch(
      () => {
        throw new Error("unexpected network request");
      },
      () =>
        assert.rejects(
          () =>
            listMyOpenPullRequests({
              repositoryPaths: [context.repoDir],
            }),
          /Git commit a{40} in octocat\/hello-world must include a valid author identity/,
        ),
    );
  });
});

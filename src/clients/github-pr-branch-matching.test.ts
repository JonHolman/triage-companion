import assert from "node:assert/strict";
import { test } from "node:test";
import { listMyOpenPullRequests } from "./github.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./github-test-support.ts";

support.describeWithExecutableWrapper("github.ts pull request branch matching", { concurrency: false }, () => {
  const context = support.setupGitHubRepositoryDiscoveryTest();

  test("listMyOpenPullRequests disambiguates same-SHA branches by pull request head ref", async () => {
    support.installFakeGit(
      context.testDir,
      "git-same-sha-pr-branch-disambiguation",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/heads/*"': `printf "${support.OBJECT_ID_A}\\trefs/heads/feature-one\\n${support.OBJECT_ID_A}\\trefs/heads/feature-two\\n"`,
      }),
    );

    let calls = 0;
    await withMockFetch(
      (input) => {
        const url = typeof input === "string" ? input : input.toString();
        calls += 1;
        assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12");
        return support.jsonResponse({ state: "open", head: { ref: "feature-two" } });
      },
      async () => {
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
      },
    );
  });

  test("listMyOpenPullRequests disambiguates same-SHA pull request heads by pull request head ref", async () => {
    support.installFakeGit(
      context.testDir,
      "git-same-sha-pr-head-disambiguation",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/pull/*/head refs/pull/*/merge"': `printf "${support.OBJECT_ID_A}\\trefs/pull/12/head\\n${support.OBJECT_ID_A}\\trefs/pull/34/head\\n${support.OBJECT_ID_B}\\trefs/pull/12/merge\\n${"c".repeat(40)}\\trefs/pull/34/merge\\n"`,
      }),
    );

    const routes = routeHandler(
      new Map([
        [
          "https://api.github.com/repos/octocat/hello-world/pulls/12",
          () => support.jsonResponse({ state: "open", head: { ref: "feature" } }),
        ],
        [
          "https://api.github.com/repos/octocat/hello-world/pulls/34",
          () => support.jsonResponse({ state: "open", head: { ref: "other-feature" } }),
        ],
      ]),
    );
    const seenURLs: string[] = [];
    await withMockFetch(
      (input) => {
        seenURLs.push(typeof input === "string" ? input : input.toString());
        return routes(input);
      },
      async () => {
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
      },
    );
  });

  test("listMyOpenPullRequests ignores branches listed in JSON env config even when branch names contain commas", async () => {
    support.installFakeGit(
      context.testDir,
      "git-ignored-branch-with-comma",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/heads/*"': `printf "${support.OBJECT_ID_A}\\trefs/heads/feature,one\\n"`,
      }),
    );
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = '["feature,one"]';

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir],
    });

    assert.deepEqual(result, []);
  });

  test("listMyOpenPullRequests allows default branch PRs when ignored branches are explicitly empty", async () => {
    support.installFakeGit(
      context.testDir,
      "git-empty-ignored-branches",
      support.pullRequestGitScript({
        '*" ls-remote origin refs/heads/*"': `printf "${support.OBJECT_ID_A}\\trefs/heads/main\\n"`,
      }),
    );
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = "[]";

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.branch, "main");
    assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
  });

  test("listMyOpenPullRequests rejects ignored branch entries with surrounding whitespace", async () => {
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = '[" main "]';

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          githubLogin: "octocat",
        }),
      /GitHub ignored branch list must contain branch names without surrounding whitespace/,
    );
  });

  test("listMyOpenPullRequests rejects ignored branch JSON with surrounding whitespace", async () => {
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = ' ["main"] ';

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          githubLogin: "octocat",
        }),
      /GitHub ignored branch list must not include surrounding whitespace/,
    );
  });

  test("listMyOpenPullRequests rejects ignored branch entries with control characters", async () => {
    process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES = '["fea\\tture"]';

    await assert.rejects(
      () =>
        listMyOpenPullRequests({
          repositoryPaths: [context.repoDir],
          githubLogin: "octocat",
        }),
      /GitHub ignored branch list must contain branch names without control characters/,
    );
  });

  test("listMyOpenPullRequests ignores duplicate explicit repository paths", async () => {
    support.installFakeGit(
      context.testDir,
      "git-local-identity-dedup",
      support.pullRequestGitScript(),
    );

    const result = await listMyOpenPullRequests({
      repositoryPaths: [context.repoDir, context.repoDir],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "https://github.com/octocat/hello-world/pull/12");
  });
});

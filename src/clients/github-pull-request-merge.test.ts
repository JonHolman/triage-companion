import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mergePullRequestFromWebURL } from "./github.ts";
import { setupGitHubCredentialsTest } from "./github-credentials-test-support.ts";
import { jsonResponse } from "./github-test-support.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";

describe("github merge pull request", { concurrency: false }, () => {
  setupGitHubCredentialsTest();

  function rejectNetwork(): Response {
    throw new Error("unexpected network request");
  }

  test("rejects unsafe pull request links before requiring a token", async () => {
    await withMockFetch(rejectNetwork, async () => {
      await assert.rejects(
        () => mergePullRequestFromWebURL("https://github.com/octocat/hello-world/issues/1"),
        /GitHub pull request link must be a GitHub pull request URL/,
      );
    });
  });

  test("merges a pull request from a GitHub web URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/12/merge");
      assert.equal(init?.method, "PUT");
      return jsonResponse({
        merged: true,
        sha: "a".repeat(40),
        message: "Pull Request successfully merged",
      });
    };

    try {
      const result = await mergePullRequestFromWebURL("https://github.com/octocat/hello-world/pull/12");

      assert.deepEqual(result, {
        repositoryFullName: "octocat/hello-world",
        pullRequestNumber: "12",
        sha: "a".repeat(40),
        message: "Pull Request successfully merged",
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("explains merge permission failures", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await withMockFetch(
      () => jsonResponse({ message: "Resource not accessible by personal access token" }, 403),
      async () => {
        await assert.rejects(
          () => mergePullRequestFromWebURL("https://github.com/octocat/hello-world/pull/12"),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(
              message,
              /GitHub API HTTP 403 while merging pull request #12 in octocat\/hello-world/,
            );
            assert.match(message, /Required permissions: classic personal access token/);
            return true;
          },
        );
      },
    );
  });

  test("rejects malformed successful merge responses", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await withMockFetch(
      () => jsonResponse({ merged: false, sha: "a".repeat(40), message: "No merge" }),
      async () => {
        await assert.rejects(
          () => mergePullRequestFromWebURL("https://github.com/octocat/hello-world/pull/12"),
          /GitHub merge pull request response must report merged=true/,
        );
      },
    );
  });
});

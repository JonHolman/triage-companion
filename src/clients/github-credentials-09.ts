import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 09", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("surfaces pull request detail API failures instead of dropping notification details", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.github.com/notifications?all=false&participating=false&per_page=1") {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              repository: {
                full_name: "octocat/hello-world",
                html_url: "https://github.com/octocat/hello-world",
              },
              subject: {
                type: "PullRequest",
                title: "Broken PR details",
                url: "https://api.github.com/repos/octocat/hello-world/pulls/1",
              },
              unread: true,
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/pulls/1");
      return new Response(JSON.stringify({ message: "Broken PR details" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub API HTTP 502 for notification pull request 1: Broken PR details/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications with invalid updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "3",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Broken timestamp",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            reason: "subscribed",
            updated_at: "not-a-date",
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification 3 must include a valid updated_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications with non-ISO updated_at timestamps", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "3",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Broken timestamp",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            reason: "subscribed",
            updated_at: "1",
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 1 }),
        /GitHub notification 3 must include a valid updated_at timestamp/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications when pagination repeats the current URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/notifications?all=false&participating=false&per_page=2";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            id: "6",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Loop",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: `<${firstURL}>; rel="next"`,
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub notifications pagination repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects notifications when pagination repeats the current URL with reordered query params", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    const firstURL = "https://api.github.com/notifications?all=false&participating=false&per_page=2";
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, firstURL);

      return new Response(
        JSON.stringify([
          {
            id: "6",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Loop",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?participating=false&per_page=2&all=false>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub notifications pagination repeated a previously fetched page/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects empty non-final notification pages", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/notifications?all=false&participating=false&per_page=2");

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub notifications response returned an empty page before pagination finished/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects GitHub pagination links that include credentials", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify([
          {
            id: "7",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Credentialed pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://reader@api.github.com/notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API URL must not include credentials/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects GitHub pagination links with surrounding whitespace inside the URL", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify([
          {
            id: "7",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Whitespace pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2 >; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API URL must not include surrounding whitespace/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects invalid GitHub pagination links clearly", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify([
          {
            id: "7",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Bad pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<not a url>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API URL must be a valid https:\/\/api\.github\.com URL/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

});

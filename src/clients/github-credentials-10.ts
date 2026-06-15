import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listNotifications, listSecurityAlertNotificationRepositories, listSecurityAlerts } from "./github.ts";
import * as support from "./github-credentials-test-support.ts";

describe("github credentials 10", { concurrency: false }, () => {
  support.setupGitHubCredentialsTest();

  test("rejects GitHub pagination links with dot path segments", async () => {
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
              title: "Dot path pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/./notifications?all=false&participating=false&per_page=2&page=2>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API pagination link must stay on the current API route/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed GitHub pagination headers instead of stopping pagination early", async () => {
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
              title: "Bad pagination header",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API pagination link must be a valid URL/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects GitHub pagination links that include fragments", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify([
          {
            id: "8",
            repository: {
              full_name: "octocat/hello-world",
              html_url: "https://github.com/octocat/hello-world",
            },
            subject: {
              type: "Issue",
              title: "Fragment pagination",
              url: "https://api.github.com/repos/octocat/hello-world/issues/1",
            },
            unread: true,
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?all=false&participating=false&per_page=2&page=2#ignored>; rel=\"next\"",
          },
        },
      );
    };

    try {
      await assert.rejects(
        () => listNotifications({ maxResults: 2 }),
        /GitHub API URL must not include fragments/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("discovers security alert repositories without rendering unrelated notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.equal(url, "https://api.github.com/notifications?all=true&participating=false&per_page=100");

      return new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "octocat/no-link",
              html_url: "https://github.com/octocat/no-link",
            },
            subject: {
              type: "UnknownThing",
              title: "No item URL",
            },
            reason: "subscribed",
          },
          {
            id: "2",
            repository: {
              full_name: "octocat/alerted",
              html_url: "https://github.com/octocat/alerted",
            },
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    try {
      assert.deepEqual(await listSecurityAlertNotificationRepositories(), ["octocat/alerted"]);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed repositories while discovering security alert notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "1",
            repository: {
              full_name: "bad owner/repo",
              html_url: "https://github.com/bad-owner/repo",
            },
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
          {
            id: "2",
            repository: {
              full_name: "octocat/alerted",
              html_url: "https://github.com/octocat/alerted",
            },
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listSecurityAlertNotificationRepositories(),
        /GitHub repository must be in owner\/repo form\./,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects missing repositories while discovering security alert notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            id: "1",
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    try {
      await assert.rejects(
        () => listSecurityAlertNotificationRepositories(),
        /GitHub notification 1 missing repository name/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("discovers security alert repositories beyond the first 200 notifications", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    const nonAlertPage = Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1),
      repository: {
        full_name: `octocat/repo-${index + 1}`,
        html_url: `https://github.com/octocat/repo-${index + 1}`,
      },
      subject: {
        type: "Issue",
        title: `Notification ${index + 1}`,
        url: `https://api.github.com/repos/octocat/repo-${index + 1}/issues/1`,
      },
      reason: "subscribed",
    }));

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;

      if (url === "https://api.github.com/notifications?all=true&participating=false&per_page=100") {
        return new Response(JSON.stringify(nonAlertPage), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?all=true&page=2&participating=false&per_page=100>; rel=\"next\"",
          },
        });
      }

      if (url === "https://api.github.com/notifications?all=true&page=2&participating=false&per_page=100") {
        return new Response(JSON.stringify(nonAlertPage.map((item, index) => ({
          ...item,
          id: String(index + 101),
          repository: {
            full_name: `octocat/repo-${index + 101}`,
            html_url: `https://github.com/octocat/repo-${index + 101}`,
          },
          subject: {
            ...item.subject,
            title: `Notification ${index + 101}`,
            url: `https://api.github.com/repos/octocat/repo-${index + 101}/issues/1`,
          },
        }))), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: "<https://api.github.com/notifications?all=true&page=3&participating=false&per_page=100>; rel=\"next\"",
          },
        });
      }

      if (url === "https://api.github.com/notifications?all=true&page=3&participating=false&per_page=100") {
        return new Response(JSON.stringify([
          {
            id: "201",
            repository: {
              full_name: "octocat/alerted",
              html_url: "https://github.com/octocat/alerted",
            },
            subject: {
              type: "RepositoryDependabotAlertsThread",
              title: "Dependabot alert",
            },
            reason: "security_alert",
          },
        ]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`unexpected url ${url}`);
    };

    try {
      assert.deepEqual(await listSecurityAlertNotificationRepositories(), ["octocat/alerted"]);
      assert.equal(calls, 3);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot pagination links outside the current GitHub API route", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100");

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://example.com/repos/octocat/hello-world/dependabot/alerts?page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub API URL must use https:\/\/api\.github\.com/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Dependabot pagination links that change the API query", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      assert.equal(url, "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100");

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: "<https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=all&per_page=100&page=2>; rel=\"next\"",
        },
      });
    };

    try {
      await assert.rejects(
        () => listSecurityAlerts(["octocat/hello-world"]),
        /GitHub API pagination link must keep the current API query/,
      );
      assert.equal(calls, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects fractional Dependabot alert limits before API requests", async () => {
    process.env.GITHUB_TOKEN = "github-env-token";

    await assert.rejects(
      () => listSecurityAlerts(["octocat/hello-world"], { maxPerRepo: 0.5 }),
      /GitHub Dependabot alert limit must be a positive integer/,
    );
  });

});

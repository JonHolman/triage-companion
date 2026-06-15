import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenTickets, saveCredentials } from "./jira.ts";
import * as support from "./jira-test-support.ts";

describe("jira client 04", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("rejects Jira issues with empty named field values", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira issues with surrounding whitespace in named field values", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: " Task ",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira issues missing issue types", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Missing issue type",
              status: {
                name: "To Do",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira issues missing priorities", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Missing priority",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira issues missing updated timestamps", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Missing updated",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira issues with invalid updated timestamps", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Broken updated timestamp",
              updated: "not-a-date",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 updated must be a valid date string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira updated timestamps with impossible calendar dates", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Broken updated timestamp",
              updated: "2026-02-31T12:00:00.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 updated must be a valid date string/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira issues with empty reporter fields", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
              reporter: {
                displayName: "",
                emailAddress: "reporter@example.com",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira issues with reporter objects missing all reporter text fields", async () => {
    process.env.JIRA_BASE_URL = "https://example.atlassian.net";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "jira-env-token";
    const originalFetch = global.fetch;

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Broken reporter",
              issuetype: { name: "Bug" },
              status: { name: "Open" },
              priority: { name: "High" },
              updated: "2026-01-01T00:00:00.000Z",
              reporter: {},
            },
          },
        ],
        startAt: 0,
        maxResults: 50,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira issues with surrounding whitespace in reporter fields", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              updated: "2026-06-13T12:38:56.000Z",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "To Do",
              },
              priority: {
                name: "Medium",
              },
              reporter: {
                displayName: " Reporter ",
                emailAddress: "reporter@example.com",
              },
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response issue ABC-123 fields must include valid top-level values/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects malformed Jira issue keys", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123/../../bad",
            fields: {
              summary: "Bad key",
            },
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
      });

    try {
      await assert.rejects(
        () => listOpenTickets(),
        /Jira API response included an invalid issue key/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

});

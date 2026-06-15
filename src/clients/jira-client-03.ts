import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenTickets, saveCredentials } from "./jira.ts";
import * as support from "./jira-test-support.ts";

describe("jira client 03", { concurrency: false }, () => {
  support.setupJiraClientTest();

  test("rejects Jira issues with invalid field value types", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: 123,
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


  test("rejects Jira issues that are already resolved", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Resolved issue",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "Done",
              },
              priority: {
                name: "Medium",
              },
              resolution: {
                name: "Done",
              },
              updated: "2026-06-13T12:34:56.000Z",
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
        /Jira API response issue ABC-123 must be unresolved/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });


  test("rejects Jira issues with malformed resolution fields", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Resolved issue",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "Done",
              },
              priority: {
                name: "Medium",
              },
              resolution: "Done",
              updated: "2026-06-13T12:34:56.000Z",
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


  test("rejects Jira issues with malformed resolution objects", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Resolved issue",
              issuetype: {
                name: "Task",
              },
              status: {
                name: "Done",
              },
              priority: {
                name: "Medium",
              },
              resolution: {},
              updated: "2026-06-13T12:34:56.000Z",
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


  test("rejects Jira issues with malformed named field objects", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid summary",
              issuetype: {
                name: "Task",
              },
              status: {},
              priority: {
                name: "Medium",
              },
              updated: "2026-06-13T12:38:56.000Z",
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


  test("rejects Jira issues missing summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
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


  test("rejects Jira issues with empty summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "",
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


  test("rejects Jira issues with surrounding whitespace in summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: " Valid summary ",
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


  test("rejects Jira issues with control characters in summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid\nsummary",
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


  test("rejects Jira issues with C1 control characters in summaries", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Valid\u009bsummary",
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


  test("rejects Jira issues missing statuses", async () => {
    const originalFetch = global.fetch;
    saveCredentials("https://stored.atlassian.net", "stored@example.com", "stored-token");

    global.fetch = async () =>
      support.createResponse({
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Missing status",
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

});

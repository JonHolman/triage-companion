import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";

import { resetCache } from "../credential-store.ts";

export interface JiraTestContext {
  readonly testDir: string;
}

export function setupJiraClientTest(): JiraTestContext {
  let originalConfigDir: string | undefined;
  let originalBaseURL: string | undefined;
  let originalEmail: string | undefined;
  let originalApiToken: string | undefined;
  let originalCloudID: string | undefined;
  let testDir = "";

  beforeEach(() => {
    originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    originalBaseURL = process.env.JIRA_BASE_URL;
    originalEmail = process.env.JIRA_EMAIL;
    originalApiToken = process.env.JIRA_API_TOKEN;
    originalCloudID = process.env.JIRA_CLOUD_ID;

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-jira-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;

    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_CLOUD_ID;
    resetCache();
  });

  afterEach(() => {
    resetCache();

    if (originalConfigDir === undefined) {
      delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
    } else {
      process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
    }

    if (originalBaseURL === undefined) {
      delete process.env.JIRA_BASE_URL;
    } else {
      process.env.JIRA_BASE_URL = originalBaseURL;
    }

    if (originalEmail === undefined) {
      delete process.env.JIRA_EMAIL;
    } else {
      process.env.JIRA_EMAIL = originalEmail;
    }

    if (originalApiToken === undefined) {
      delete process.env.JIRA_API_TOKEN;
    } else {
      process.env.JIRA_API_TOKEN = originalApiToken;
    }

    if (originalCloudID === undefined) {
      delete process.env.JIRA_CLOUD_ID;
    } else {
      process.env.JIRA_CLOUD_ID = originalCloudID;
    }

    fs.rmSync(testDir, { force: true, recursive: true });
  });

  return {
    get testDir() {
      return testDir;
    },
  };
}

export function createResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function issueFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: "Valid summary",
    issuetype: { name: "Task" },
    status: { name: "To Do" },
    priority: { name: "Medium" },
    updated: "2026-06-13T12:38:56.000Z",
    ...overrides,
  };
}

export function searchIssue(
  key: string,
  fieldOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { key, fields: issueFields(fieldOverrides) };
}

function searchPage(
  issues: unknown[],
  page: Record<string, unknown> = {},
): Record<string, unknown> {
  return { issues, ...page };
}

export function searchResponse(
  issues: unknown[],
  page: Record<string, unknown> = {},
): Response {
  return createResponse(searchPage(issues, page));
}

export function searchURL(baseURL: string, nextPageToken?: string): string {
  const params = new URLSearchParams({
    jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
    fields: "summary,status,priority,issuetype,reporter,updated,resolution",
    maxResults: "100",
  });
  if (nextPageToken !== undefined) {
    params.set("nextPageToken", nextPageToken);
  }

  return `${baseURL}/rest/api/3/search/jql?${params}`;
}

export function dataCenterSearchURL(baseURL: string, startAt: number = 0): string {
  const params = new URLSearchParams({
    jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
    fields: "summary,status,priority,issuetype,reporter,updated,resolution",
    maxResults: "100",
    startAt: String(startAt),
  });

  return `${baseURL}/rest/api/2/search?${params}`;
}

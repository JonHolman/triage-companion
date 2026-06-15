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
  let testDir = "";

  beforeEach(() => {
    originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    originalBaseURL = process.env.JIRA_BASE_URL;
    originalEmail = process.env.JIRA_EMAIL;
    originalApiToken = process.env.JIRA_API_TOKEN;

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-jira-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;

    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
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

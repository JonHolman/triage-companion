import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";

import { resetCache } from "../credential-store.ts";

export interface GitHubCredentialsTestContext {
  readonly testDir: string;
}

export function setupGitHubCredentialsTest(): GitHubCredentialsTestContext {
  let originalConfigDir: string | undefined;
  let originalToken: string | undefined;
  let testDir = "";

  beforeEach(() => {
    originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    originalToken = process.env.GITHUB_TOKEN;

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-credentials-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    resetCache();
  });

  afterEach(() => {
    resetCache();

    if (originalConfigDir === undefined) {
      delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
    } else {
      process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
    }

    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }

    fs.rmSync(testDir, { force: true, recursive: true });
  });

  return {
    get testDir() {
      return testDir;
    },
  };
}

export function jsonResponse(
  body: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
}

export function notificationsUrl(perPage: number): string {
  return `https://api.github.com/notifications?all=false&participating=false&per_page=${perPage}`;
}

export function notificationJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "1",
    repository: {
      full_name: "octocat/hello-world",
      html_url: "https://github.com/octocat/hello-world",
    },
    subject: {
      type: "Issue",
      title: "Issue update",
      url: "https://api.github.com/repos/octocat/hello-world/issues/1",
    },
    unread: true,
    ...overrides,
  };
}

export function workflowRunsUrl(perPage: number): string {
  return `https://api.github.com/repos/octocat/hello-world/actions/runs?status=failure&per_page=${perPage}`;
}

export function workflowRunJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 123,
    name: "CI",
    display_title: "fix bug",
    status: "completed",
    conclusion: "failure",
    html_url: "https://github.com/octocat/hello-world/actions/runs/123",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export const DEPENDABOT_ALERTS_URL =
  "https://api.github.com/repos/octocat/hello-world/dependabot/alerts?state=open&per_page=100";

export function dependabotAlertJson(
  alertNumber: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    number: alertNumber,
    state: "open",
    html_url: `https://github.com/octocat/hello-world/security/dependabot/${alertNumber}`,
    ...overrides,
  };
}

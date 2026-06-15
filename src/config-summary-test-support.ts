import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";

import { ENV } from "./config.ts";
import { resetCache } from "./credential-store.ts";

export function setupConfigSummaryTest(): { readonly testDir: string } {
  const state = { testDir: "" };
  let originalConfigDir: string | undefined;
  let originalGitBinary: string | undefined;
  let originalSearchRoots: string | undefined;
  let originalGitHubToken: string | undefined;
  let originalSnykToken: string | undefined;
  let originalSnykApiBaseURL: string | undefined;
  let originalJiraBaseURL: string | undefined;
  let originalJiraEmail: string | undefined;
  let originalJiraApiToken: string | undefined;
  let originalIgnoredBranches: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    originalGitBinary = process.env[ENV.GIT_BINARY];
    originalSearchRoots = process.env[ENV.GIT_SEARCH_ROOTS];
    originalGitHubToken = process.env.GITHUB_TOKEN;
    originalSnykToken = process.env.SNYK_TOKEN;
    originalSnykApiBaseURL = process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    originalJiraBaseURL = process.env.JIRA_BASE_URL;
    originalJiraEmail = process.env.JIRA_EMAIL;
    originalJiraApiToken = process.env.JIRA_API_TOKEN;
    originalIgnoredBranches = process.env[ENV.GITHUB_PR_IGNORE_BRANCHES];
    state.testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-config-summary-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = state.testDir;
    delete process.env[ENV.GIT_BINARY];
    delete process.env[ENV.GIT_SEARCH_ROOTS];
    delete process.env.GITHUB_TOKEN;
    delete process.env.SNYK_TOKEN;
    delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    delete process.env[ENV.GITHUB_PR_IGNORE_BRANCHES];
    resetCache();
  });

  afterEach(() => {
    resetCache();
    if (originalConfigDir === undefined) {
      delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
    } else {
      process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
    }

    if (originalGitBinary === undefined) {
      delete process.env[ENV.GIT_BINARY];
    } else {
      process.env[ENV.GIT_BINARY] = originalGitBinary;
    }

    if (originalSearchRoots === undefined) {
      delete process.env[ENV.GIT_SEARCH_ROOTS];
    } else {
      process.env[ENV.GIT_SEARCH_ROOTS] = originalSearchRoots;
    }

    if (originalGitHubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGitHubToken;
    }

    if (originalSnykToken === undefined) {
      delete process.env.SNYK_TOKEN;
    } else {
      process.env.SNYK_TOKEN = originalSnykToken;
    }

    if (originalSnykApiBaseURL === undefined) {
      delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    } else {
      process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = originalSnykApiBaseURL;
    }

    if (originalJiraBaseURL === undefined) {
      delete process.env.JIRA_BASE_URL;
    } else {
      process.env.JIRA_BASE_URL = originalJiraBaseURL;
    }

    if (originalJiraEmail === undefined) {
      delete process.env.JIRA_EMAIL;
    } else {
      process.env.JIRA_EMAIL = originalJiraEmail;
    }

    if (originalJiraApiToken === undefined) {
      delete process.env.JIRA_API_TOKEN;
    } else {
      process.env.JIRA_API_TOKEN = originalJiraApiToken;
    }

    if (originalIgnoredBranches === undefined) {
      delete process.env[ENV.GITHUB_PR_IGNORE_BRANCHES];
    } else {
      process.env[ENV.GITHUB_PR_IGNORE_BRANCHES] = originalIgnoredBranches;
    }

    fs.rmSync(state.testDir, { force: true, recursive: true });
  });

  return state;
}

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { buildConfigurationSummary } from "./config-summary.ts";
import { ENV, saveSearchRoots } from "./config.ts";
import { configFilePath, resetCache, save } from "./credential-store.ts";

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
let testDir = "";

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
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-config-summary-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
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

  fs.rmSync(testDir, { force: true, recursive: true });
});

describe("configuration summary", () => {
  test("does not expose token values", () => {
    save("Triage Companion-GitHub", "notifications-token", "secret-token");
    save("Triage Companion-Snyk", "token", "snyk-secret");
    saveSearchRoots([path.join(testDir, "Projects")]);
    fs.mkdirSync(path.join(testDir, "Projects"));

    const summary = buildConfigurationSummary();

    assert.match(summary, /GitHub/);
    assert.match(summary, /configured/);
    assert.ok(!summary.includes("secret-token"));
    assert.ok(!summary.includes("snyk-secret"));
  });

  test("shows environment git search roots as configured", () => {
    const envRoot = path.join(testDir, "env-root");
    fs.mkdirSync(envRoot);
    process.env[ENV.GIT_SEARCH_ROOTS] = JSON.stringify([envRoot]);

    const summary = buildConfigurationSummary();

    assert.match(summary, new RegExp(`configured: ${envRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(environment\\)`));
  });

  test("shows an explicit empty environment git search root override as configured", () => {
    const storedRoot = path.join(testDir, "stored-root");
    fs.mkdirSync(storedRoot);
    saveSearchRoots([storedRoot]);
    process.env[ENV.GIT_SEARCH_ROOTS] = "[]";

    const summary = buildConfigurationSummary();

    assert.match(summary, /effective: \(none\)/);
    assert.match(summary, /configured: \(none\) \(environment\)/);
  });

  test("reports environment git search roots with control characters as configuration errors", () => {
    process.env[ENV.GIT_SEARCH_ROOTS] = '["/tmp/repo\\tbad"]';

    const summary = buildConfigurationSummary();

    assert.match(summary, /Git search roots/);
    assert.match(summary, /Configuration error: Git search roots must contain paths without control characters/);
  });

  test("reports environment git search roots with surrounding whitespace in entries as configuration errors", () => {
    process.env[ENV.GIT_SEARCH_ROOTS] = '[" /tmp/repo "]';

    const summary = buildConfigurationSummary();

    assert.match(summary, /Git search roots/);
    assert.match(summary, /Configuration error: Git search roots must contain paths without surrounding whitespace/);
  });

  test("reports environment git search roots with surrounding whitespace around the JSON value", () => {
    process.env[ENV.GIT_SEARCH_ROOTS] = ' ["/tmp/repo"] ';

    const summary = buildConfigurationSummary();

    assert.match(summary, /Git search roots/);
    assert.match(summary, /Configuration error: Git search roots must not include surrounding whitespace/);
  });

  test("does not read invalid stored git search roots when an environment override is active", () => {
    fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
    fs.writeFileSync(configFilePath(), JSON.stringify({
      "Triage Companion-Config\u001fgit-search-roots": "{",
    }), "utf-8");
    const envRoot = path.join(testDir, "env-root");
    fs.mkdirSync(envRoot);
    process.env[ENV.GIT_SEARCH_ROOTS] = JSON.stringify([envRoot]);
    resetCache();

    const summary = buildConfigurationSummary();

    assert.match(summary, new RegExp(`configured: ${envRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(environment\\)`));
    assert.doesNotMatch(summary, /Stored Git search roots are not valid JSON/);
  });

  test("reports blank stored git search roots as configuration errors instead of defaulting", () => {
    save("Triage Companion-Config", "git-search-roots", "");

    const summary = buildConfigurationSummary();

    assert.match(summary, /Git search roots/);
    assert.match(summary, /Configuration error: Stored Git search roots are not valid JSON/);
    assert.doesNotMatch(summary, /configured: \(default roots\)/);
  });

  test("reports unreadable credential stores instead of showing environment GitHub tokens", () => {
    fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
    fs.writeFileSync(configFilePath(), "not json", "utf-8");
    process.env.GITHUB_TOKEN = "env-github-token";
    resetCache();

    const summary = buildConfigurationSummary();

    assert.match(summary, /GitHub/);
    assert.match(summary, /GitHub\n {2}Configuration error: Credential store .* is not valid JSON/);
    assert.doesNotMatch(summary, /GitHub token: configured \(environment\)/);
    assert.ok(!summary.includes("env-github-token"));
  });

  test("shows invalid environment GitHub tokens as invalid instead of configured", () => {
    process.env.GITHUB_TOKEN = "bad\ngithub-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /GitHub token: invalid \(environment\)/);
    assert.match(summary, /Configuration errors:/);
    assert.match(summary, /GitHub token is invalid: must not include control characters/);
    assert.ok(!summary.includes("bad\ngithub-token"));
  });

  test("reports invalid config directory overrides through the credentials file line", () => {
    process.env[ENV.CONFIG_DIR] = " ~/triage-config ";

    const summary = buildConfigurationSummary();

    assert.match(
      summary,
      /Credentials file: unavailable \(TRIAGE_COMPANION_CONFIG_DIR is invalid: must not include surrounding whitespace\.\)/,
    );
  });

  test("escapes control characters in credentials path errors", () => {
    process.env[ENV.CONFIG_DIR] = "bad\tpath";

    const summary = buildConfigurationSummary();

    assert.match(
      summary,
      /Credentials file: unavailable \(TRIAGE_COMPANION_CONFIG_DIR is invalid: must not include control characters\.\)/,
    );
    assert.equal(summary.includes("\t"), false);
  });

  test("reports credential store errors without exposing secrets", () => {
    fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
    fs.writeFileSync(configFilePath(), "not json", "utf-8");
    resetCache();

    const summary = buildConfigurationSummary();

    assert.match(summary, /Configuration error:/);
    assert.match(summary, /not valid JSON/);
    assert.ok(!summary.includes("secret-token"));
  });

  test("escapes control characters in credential store errors", () => {
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]).endsWith("secrets.json")) {
        throw new Error("bad\tconfig\nretry");
      }

      return originalReadFileSync(...args);
    }) as typeof fs.readFileSync;
    resetCache();

    try {
      const summary = buildConfigurationSummary();
      assert.match(summary, /Configuration error: Could not read credential store .*bad\\tconfig, retry/);
      assert.equal(summary.includes("\t"), false);
    } finally {
      fs.readFileSync = originalReadFileSync;
      resetCache();
    }
  });

  test("reports service validation errors without exposing secrets", () => {
    save("Triage Companion-Snyk", "token", "snyk-secret");
    save("Triage Companion-Config", "snyk-api-base-url", "https://api.eu.snyk.io/rest");

    const summary = buildConfigurationSummary();

    assert.match(summary, /Snyk/);
    assert.match(summary, /Configuration errors:/);
    assert.match(summary, /API base URL is invalid/);
    assert.ok(!summary.includes("snyk-secret"));
  });

  test("shows invalid stored Snyk tokens as invalid instead of configured", () => {
    save("Triage Companion-Snyk", "token", "bad\nsnyk-token");

    const summary = buildConfigurationSummary();

    assert.match(summary, /Snyk API token: invalid/);
    assert.match(summary, /Configuration errors:/);
    assert.match(summary, /Snyk API token is invalid: must not include control characters/);
    assert.ok(!summary.includes("bad\nsnyk-token"));
  });

  test("shows blank invalid stored Snyk API base URLs instead of omitting them", () => {
    save("Triage Companion-Snyk", "token", "snyk-secret");
    save("Triage Companion-Config", "snyk-api-base-url", "");

    const summary = buildConfigurationSummary();

    assert.match(summary, /API base URL: invalid/);
    assert.match(summary, /API base URL is invalid: must be a valid https:\/\/ URL/);
  });

  test("shows environment Jira API tokens as environment-configured", () => {
    save("Triage Companion-Jira", "base-url", "https://example.atlassian.net");
    save("Triage Companion-Jira", "email", "dev@example.com");
    save("Triage Companion-Jira", "api-token", "stored-jira-token");
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Jira/);
    assert.match(summary, /API token: configured \(environment\)/);
    assert.ok(!summary.includes("stored-jira-token"));
    assert.ok(!summary.includes("env-jira-token"));
  });

  test("shows canonical Jira base URLs from environment", () => {
    process.env.JIRA_BASE_URL = "example.atlassian.net";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Base URL: https:\/\/example\.atlassian\.net/);
    assert.ok(!summary.includes("Base URL: example.atlassian.net"));
  });

  test("shows blank invalid Jira email overrides as invalid instead of not set", () => {
    process.env.JIRA_BASE_URL = "https://example.atlassian.net";
    process.env.JIRA_EMAIL = "   ";
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Email: invalid \(environment\)/);
    assert.match(summary, /Email is invalid: must not be empty/);
    assert.doesNotMatch(summary, /Email: not set/);
  });

  test("keeps Jira base URLs with surrounding whitespace visible when invalid", () => {
    process.env.JIRA_BASE_URL = " https://example.atlassian.net ";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Base URL: {2}https:\/\/example\.atlassian\.net /);
    assert.match(summary, /Base URL is invalid: must not include surrounding whitespace/);
  });

  test("keeps Jira base URLs with control characters visible when invalid", () => {
    process.env.JIRA_BASE_URL = "https://exa\tmple.atlassian.net";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Base URL: https:\/\/exa\\tmple\.atlassian\.net/);
    assert.match(summary, /Base URL is invalid: must not include control characters/);
  });

  test("keeps Jira base URLs with dot path segments visible when invalid", () => {
    process.env.JIRA_BASE_URL = "https://example.atlassian.net/%2E/";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Base URL: https:\/\/example\.atlassian\.net\/%2E\//);
    assert.match(summary, /Base URL is invalid: must not include dot path segments/);
  });

  test("redacts Jira base URLs with embedded credentials when invalid", () => {
    process.env.JIRA_BASE_URL = "https://user:secret@example.atlassian.net";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Base URL: invalid \(environment\)/);
    assert.match(summary, /Base URL is invalid: must not include credentials/);
    assert.ok(!summary.includes("user:secret"));
  });

  test("redacts malformed Jira base URLs with embedded credentials", () => {
    process.env.JIRA_BASE_URL = "https://user:secret@";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Base URL: invalid \(environment\)/);
    assert.ok(!summary.includes("user:secret"));
  });

  test("shows canonical Snyk API base URLs from environment", () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://API.US.SNYK.IO/rest/";
    process.env.SNYK_TOKEN = "env-snyk-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /API base URL: https:\/\/api\.us\.snyk\.io\/rest/);
    assert.ok(!summary.includes("API base URL: https://API.US.SNYK.IO/rest/"));
  });

  test("keeps Snyk API base URLs with surrounding whitespace visible when invalid", () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = " https://api.snyk.io/rest ";
    process.env.SNYK_TOKEN = "env-snyk-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /API base URL: {2}https:\/\/api\.snyk\.io\/rest /);
    assert.match(summary, /API base URL is invalid: must not include surrounding whitespace/);
  });

  test("keeps Snyk API base URLs with control characters visible when invalid", () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.snyk.io/re\nst";
    process.env.SNYK_TOKEN = "env-snyk-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /API base URL: https:\/\/api\.snyk\.io\/re, st/);
    assert.match(summary, /API base URL is invalid: must not include control characters/);
  });

  test("keeps Snyk API base URLs with dot path segments visible when invalid", () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://api.snyk.io/rest/%2E/";
    process.env.SNYK_TOKEN = "env-snyk-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /API base URL: https:\/\/api\.snyk\.io\/rest\/%2E\//);
    assert.match(summary, /API base URL is invalid: must not include dot path segments/);
  });

  test("redacts stored Snyk API base URLs with embedded credentials when invalid", () => {
    save("Triage Companion-Snyk", "token", "snyk-secret");
    save("Triage Companion-Config", "snyk-api-base-url", "https://user:secret@api.snyk.io/rest");

    const summary = buildConfigurationSummary();

    assert.match(summary, /API base URL: invalid/);
    assert.match(summary, /API base URL is invalid: must not include credentials/);
    assert.ok(!summary.includes("user:secret"));
  });

  test("redacts malformed Snyk API base URLs with embedded credentials", () => {
    process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = "https://user:secret@";
    process.env.SNYK_TOKEN = "env-snyk-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /API base URL: invalid \(environment\)/);
    assert.ok(!summary.includes("user:secret"));
  });

  test("reports invalid git binary configuration clearly", () => {
    process.env[ENV.GIT_BINARY] = "/definitely/missing/git";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Git/);
    assert.match(summary, /Git binary is invalid/);
    assert.match(summary, /must point to an executable path/);
  });

  test("reports non-git executable configuration clearly", () => {
    const fakeGit = path.join(testDir, "fake-git");
    fs.writeFileSync(fakeGit, "#!/bin/sh\necho not-git\n", { mode: 0o755 });
    process.env[ENV.GIT_BINARY] = fakeGit;

    const summary = buildConfigurationSummary();

    assert.match(summary, /Git/);
    assert.match(summary, /Git binary is invalid/);
    assert.match(summary, /must point to a git executable/);
  });

  test("formats optional default values without breaking summary lines", () => {
    const summary = buildConfigurationSummary();

    assert.match(summary, /Ignored PR branches: main, master, production/);
    assert.ok(!summary.includes("Ignored PR branches: main\nmaster\nproduction"));
  });

  test("formats ignored branch environment overrides as a readable list", () => {
    process.env[ENV.GITHUB_PR_IGNORE_BRANCHES] = '["release","hotfix"]';

    const summary = buildConfigurationSummary();

    assert.match(summary, /Ignored PR branches: release, hotfix/);
    assert.ok(!summary.includes('Ignored PR branches: ["release","hotfix"]'));
  });

  test("formats an explicit empty ignored branch environment override as none", () => {
    process.env[ENV.GITHUB_PR_IGNORE_BRANCHES] = "[]";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Ignored PR branches: \(none\)/);
  });

  test("ignores blank ignored branch environment overrides and shows the defaults", () => {
    process.env[ENV.GITHUB_PR_IGNORE_BRANCHES] = "   ";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Ignored PR branches: main, master, production/);
    assert.doesNotMatch(summary, /Ignored PR branches: \(none\)/);
  });

  test("omits blank author regex environment overrides", () => {
    process.env[ENV.GITHUB_PR_AUTHOR_REGEX] = "   ";

    const summary = buildConfigurationSummary();

    assert.doesNotMatch(summary, /PR author regex:/);
  });

  test("shows invalid author regex overrides with escaped control characters", () => {
    process.env[ENV.GITHUB_PR_AUTHOR_REGEX] = "repo\t@example\\.com";

    const summary = buildConfigurationSummary();

    assert.match(summary, /PR author regex: repo\\t@example\\\.com/);
    assert.match(summary, /PR author regex is invalid: must not include control characters/);
  });

  test("shows invalid ignored branch overrides raw instead of prettifying them", () => {
    process.env[ENV.GITHUB_PR_IGNORE_BRANCHES] = '[" main "]';

    const summary = buildConfigurationSummary();

    assert.match(summary, /Ignored PR branches: \[" main "\]/);
    assert.match(summary, /Ignored PR branches is invalid: must contain branch names without surrounding whitespace/);
  });

  test("shows ignored branch overrides with surrounding whitespace around the JSON value raw instead of prettifying them", () => {
    process.env[ENV.GITHUB_PR_IGNORE_BRANCHES] = ' ["main"] ';

    const summary = buildConfigurationSummary();

    assert.match(summary, /Ignored PR branches: {2}\["main"\] /);
    assert.match(summary, /Ignored PR branches is invalid: must not include surrounding whitespace/);
  });

  test("shows ignored branch overrides with control characters raw instead of prettifying them", () => {
    process.env[ENV.GITHUB_PR_IGNORE_BRANCHES] = '["fea\\tture"]';

    const summary = buildConfigurationSummary();

    assert.match(summary, /Ignored PR branches: \["fea\\tture"\]/);
    assert.match(summary, /Ignored PR branches is invalid: must contain branch names without control characters/);
  });

  test("escapes control characters when showing invalid raw overrides", () => {
    process.env[ENV.GITHUB_PR_IGNORE_BRANCHES] = "[\"main\t\"]";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Ignored PR branches: \["main\\t"\]/);
    assert.match(summary, /Ignored PR branches is invalid: must be a JSON array of branch names/);
    assert.ok(!summary.includes("\t"));
  });

  test("omits empty service sections", () => {
    const summary = buildConfigurationSummary();

    assert.ok(!summary.includes("\nGit\n\nGit search roots"));
  });
});

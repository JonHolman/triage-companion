import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { buildConfigurationSummary } from "./config-summary.ts";
import { ENV, saveSearchRoots } from "./config.ts";
import { configFilePath, save } from "./credential-store.ts";
import { setupConfigSummaryTest } from "./config-summary-test-support.ts";

const configSummaryTest = setupConfigSummaryTest();

describe("configuration summary", () => {
  test("does not expose token values", () => {
    save("Triage Companion-GitHub", "notifications-token", "secret-token");
    save("Triage Companion-Snyk", "token", "snyk-secret");
    saveSearchRoots([path.join(configSummaryTest.testDir, "Projects")]);
    fs.mkdirSync(path.join(configSummaryTest.testDir, "Projects"));

    const summary = buildConfigurationSummary();

    assert.match(summary, /GitHub/);
    assert.match(summary, /configured/);
    assert.ok(!summary.includes("secret-token"));
    assert.ok(!summary.includes("snyk-secret"));
  });

  test("shows environment git search roots as configured", () => {
    const envRoot = path.join(configSummaryTest.testDir, "env-root");
    fs.mkdirSync(envRoot);
    process.env[ENV.GIT_SEARCH_ROOTS] = JSON.stringify([envRoot]);

    const summary = buildConfigurationSummary();

    assert.match(summary, new RegExp(`configured: ${envRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(environment\\)`));
  });

  test("shows an explicit empty environment git search root override as configured", () => {
    const storedRoot = path.join(configSummaryTest.testDir, "stored-root");
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
    const envRoot = path.join(configSummaryTest.testDir, "env-root");
    fs.mkdirSync(envRoot);
    process.env[ENV.GIT_SEARCH_ROOTS] = JSON.stringify([envRoot]);

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

    try {
      const summary = buildConfigurationSummary();
      assert.match(summary, /Configuration error: Could not read credential store .*bad\\tconfig, retry/);
      assert.equal(summary.includes("\t"), false);
    } finally {
      fs.readFileSync = originalReadFileSync;
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
    save("Triage Companion-Jira", "cloud-id", "11111111-2222-3333-4444-555555555555");
    process.env.JIRA_API_TOKEN = "env-jira-token";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Jira/);
    assert.match(summary, /API token: configured \(environment\)/);
    assert.match(summary, /Cloud ID: 11111111-2222-3333-4444-555555555555/);
    assert.ok(!summary.includes("stored-jira-token"));
    assert.ok(!summary.includes("env-jira-token"));
  });

  test("reports invalid Jira Cloud ID overrides", () => {
    process.env.JIRA_BASE_URL = "https://example.atlassian.net";
    process.env.JIRA_EMAIL = "dev@example.com";
    process.env.JIRA_API_TOKEN = "env-jira-token";
    process.env.JIRA_CLOUD_ID = "not-a-cloud-id";

    const summary = buildConfigurationSummary();

    assert.match(summary, /Cloud ID: not-a-cloud-id/);
    assert.match(summary, /Cloud ID is invalid: must be an Atlassian Cloud ID UUID/);
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
    const fakeGit = path.join(configSummaryTest.testDir, "fake-git");
    fs.writeFileSync(fakeGit, "#!/bin/sh\necho not-git\n", { mode: 0o755 });
    process.env[ENV.GIT_BINARY] = fakeGit;

    const summary = buildConfigurationSummary();

    assert.match(summary, /Git/);
    assert.match(summary, /Git binary is invalid/);
    assert.match(summary, /must point to a git executable/);
  });

});

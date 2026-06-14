import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  DEFAULT_SEARCH_ROOTS,
  getServiceDefinition,
  resolveServiceState,
} from "./config-model.ts";

describe("configuration model", () => {
  test("defines expected service metadata and persistence boundaries", () => {
    const github = getServiceDefinition("github");
    const git = getServiceDefinition("git");
    const jira = getServiceDefinition("jira");
    const snyk = getServiceDefinition("snyk");
    const local = getServiceDefinition("local");

    const githubToken = github.requiredSettings.find((field) => field.key === "token");
    const jiraBaseURL = jira.requiredSettings.find((field) => field.key === "baseURL");
    const jiraApiToken = jira.requiredSettings.find((field) => field.key === "apiToken");
    const snykToken = snyk.requiredSettings.find((field) => field.key === "token");
    const snykAPIBaseURL = snyk.optionalSettings.find((field) => field.key === "apiBaseURL");

    assert.ok(githubToken);
    assert.ok(jiraBaseURL);
    assert.ok(jiraApiToken);
    assert.ok(snykToken);
    assert.ok(snykAPIBaseURL);

    const githubAuthorRegex = github.optionalSettings.find((field) => field.key === "authorRegex");
    const githubIgnoredBranches = github.optionalSettings.find((field) => field.key === "ignoredBranches");
    assert.ok(githubAuthorRegex);
    assert.ok(githubIgnoredBranches);
    assert.equal(githubAuthorRegex.validate?.("octocat|repo@example.com"), null);
    assert.match(githubAuthorRegex.validate?.("(") ?? "", /regular expression/);
    assert.match(githubAuthorRegex.validate?.("repo\t@example.com") ?? "", /control characters/);
    assert.equal(githubIgnoredBranches.validate?.('["main","feature,one"]'), null);
    assert.match(githubIgnoredBranches.validate?.("main,feature") ?? "", /JSON array/);
    assert.match(githubIgnoredBranches.validate?.(' ["main"] ') ?? "", /surrounding whitespace/);
    assert.match(githubIgnoredBranches.validate?.('[" main "]') ?? "", /surrounding whitespace/);
    assert.match(githubIgnoredBranches.validate?.('["fea\\tture"]') ?? "", /control characters/);
    assert.match(githubToken.validate?.(" github-token ") ?? "", /surrounding whitespace/);
    assert.match(githubToken.validate?.("bad\ntoken") ?? "", /control characters/);

    assert.equal(githubToken.secret, true);
    assert.equal(githubToken.persisted, true);
    assert.ok(githubToken.storage?.service.includes("GitHub"));
    assert.equal(jiraBaseURL.required, true);
    assert.equal(jiraBaseURL.persisted, true);
    assert.equal(jiraBaseURL.validate?.("https://example.atlassian.net"), null);
    assert.match(jiraBaseURL.validate?.(" https://example.atlassian.net ") ?? "", /surrounding whitespace/);
    assert.match(jiraBaseURL.validate?.("https://exa\tmple.atlassian.net") ?? "", /control characters/);
    assert.match(jiraBaseURL.validate?.("https://example.atlassian.net/%2E/") ?? "", /dot path segments/);
    assert.match(jiraBaseURL.validate?.("http://example.atlassian.net") ?? "", /https/);
    assert.match(jiraBaseURL.validate?.("https://user@example.atlassian.net") ?? "", /credentials/);
    assert.match(jiraBaseURL.validate?.("https://example.atlassian.net:8443") ?? "", /port/);
    assert.match(jiraBaseURL.validate?.("https://example.atlassian.net/browse/ABC-123") ?? "", /site root/);
    const jiraEmail = jira.requiredSettings.find((field) => field.key === "email");
    assert.ok(jiraEmail);
    assert.match(jiraEmail.validate?.(" dev@example.com ") ?? "", /surrounding whitespace/);
    assert.match(jiraEmail.validate?.("dev\n@example.com") ?? "", /control characters/);
    assert.equal(jiraApiToken.secret, true);
    assert.equal(jiraApiToken.persisted, true);
    assert.equal(jiraApiToken.environmentOverridesStored, true);
    assert.match(jiraApiToken.validate?.(" jira-token ") ?? "", /surrounding whitespace/);
    assert.match(jiraApiToken.validate?.("bad\ntoken") ?? "", /control characters/);
    assert.equal(snykToken.secret, true);
    assert.equal(snykToken.persisted, true);
    assert.match(snykToken.validate?.(" snyk-token ") ?? "", /surrounding whitespace/);
    assert.match(snykToken.validate?.("bad\ntoken") ?? "", /control characters/);
    assert.equal(snykAPIBaseURL.persisted, true);
    assert.ok(snykAPIBaseURL.storage?.service.includes("Config"));
    assert.equal(snykAPIBaseURL.envVar, "TRIAGE_COMPANION_SNYK_API_BASE_URL");
    assert.equal(snykAPIBaseURL.validate?.("https://api.us.snyk.io/rest/"), null);
    assert.equal(snykAPIBaseURL.validate?.("https://API.US.SNYK.IO/rest/"), null);
    assert.match(snykAPIBaseURL.validate?.(" https://api.snyk.io/rest ") ?? "", /surrounding whitespace/);
    assert.match(snykAPIBaseURL.validate?.("https://api.snyk.io/re\nst") ?? "", /control characters/);
    assert.match(snykAPIBaseURL.validate?.("https://api.snyk.io/rest/%2E/") ?? "", /dot path segments/);
    assert.match(snykAPIBaseURL.validate?.("https://user@api.snyk.io/rest") ?? "", /credentials/);
    assert.match(snykAPIBaseURL.validate?.("https://api.snyk.io:8443/rest") ?? "", /port/);
    assert.match(snykAPIBaseURL.validate?.("https://api.snykgov.io/rest") ?? "", /OAuth/);
    assert.match(snykAPIBaseURL.validate?.("https://api.eu.snyk.io/rest") ?? "", /US REST API/);

    const snykOrganizationIds = snyk.optionalSettings.find((field) => field.key === "organizationIds");
    assert.ok(snykOrganizationIds);
    assert.equal(snykOrganizationIds.validate?.("org-1,org_2.example"), null);
    assert.match(snykOrganizationIds.validate?.(",,,") ?? "", /at least one ID/);
    assert.match(snykOrganizationIds.validate?.("org-1,") ?? "", /safe IDs/);
    assert.match(snykOrganizationIds.validate?.("org-1,../bad") ?? "", /safe IDs/);
    assert.match(
      snykOrganizationIds.validate?.("org-1, org_2.example") ?? "",
      /surrounding whitespace/,
    );
    assert.match(snykOrganizationIds.validate?.(" org-1,org_2.example ") ?? "", /surrounding whitespace/);

    const gitBinary = git.optionalSettings.find((field) => field.key === "binary");
    assert.ok(gitBinary);
    assert.match(gitBinary.validate?.("/definitely/missing/git") ?? "", /executable path/);

    const executable = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-binary-"));
    const binaryPath = path.join(executable, "git");
    fs.writeFileSync(binaryPath, "#!/bin/sh\necho 'git version 2.0.0'\n");
    fs.chmodSync(binaryPath, 0o755);
    assert.equal(gitBinary.validate?.(binaryPath), null);
    const paddedVersionBinaryPath = path.join(executable, "padded-version-git");
    fs.writeFileSync(paddedVersionBinaryPath, "#!/bin/sh\necho ' git version 2.0.0'\n");
    fs.chmodSync(paddedVersionBinaryPath, 0o755);
    assert.match(gitBinary.validate?.(paddedVersionBinaryPath) ?? "", /git executable/);
    const fakeBinaryPath = path.join(executable, "not-git");
    fs.writeFileSync(fakeBinaryPath, "#!/bin/sh\necho 'not git'\n");
    fs.chmodSync(fakeBinaryPath, 0o755);
    assert.match(gitBinary.validate?.(fakeBinaryPath) ?? "", /git executable/);
    assert.match(gitBinary.validate?.(executable) ?? "", /executable path/);
    const originalHome = process.env.HOME;
    const badHome = `${fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-binary-home-"))}\tbad`;
    fs.mkdirSync(badHome, { recursive: true });
    const homeRelativeBinaryPath = path.join(badHome, "git");
    fs.writeFileSync(homeRelativeBinaryPath, "#!/bin/sh\necho 'git version 2.0.0'\n");
    fs.chmodSync(homeRelativeBinaryPath, 0o755);
    try {
      process.env.HOME = badHome;
      assert.equal(gitBinary.validate?.(binaryPath), null);
      assert.match(gitBinary.validate?.("~/git") ?? "", /control characters/);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
    fs.rmSync(executable, { recursive: true, force: true });

    assert.ok(github.status.permissionRequirements.length > 0);
    assert.ok(jira.status.permissionRequirements.length > 0);
    assert.ok(snyk.status.permissionRequirements.length > 0);
    assert.equal(local.status.saveHint, "triage-companion config git-search-roots <paths-json>");
    const localSearchRoots = local.optionalSettings.find((field) => field.key === "searchRoots");
    const localConfigDirectory = local.optionalSettings.find((field) => field.key === "configDirectory");
    assert.equal(localSearchRoots?.persisted, true);
    assert.equal(localSearchRoots?.validate?.('["~/repos"]'), null);
    assert.match(localSearchRoots?.validate?.("{") ?? "", /JSON array/);
    assert.match(localSearchRoots?.validate?.("") ?? "", /JSON array/);
    assert.match(localSearchRoots?.validate?.(' ["~/repos"] ') ?? "", /surrounding whitespace/);
    assert.match(localSearchRoots?.validate?.('[" ~/repos "]') ?? "", /surrounding whitespace/);
    assert.match(localSearchRoots?.validate?.('["~/repo\\ts"]') ?? "", /control characters/);
    assert.ok(localConfigDirectory);
    assert.match(localConfigDirectory.validate?.(" ~/triage-config ") ?? "", /surrounding whitespace/);
    assert.match(localConfigDirectory.validate?.("bad\nconfig") ?? "", /control characters/);
  });

  test("uses environment values when no secrets are persisted", () => {
    const result = resolveServiceState("jira", {
      readEnv: (name) =>
        name === "JIRA_BASE_URL"
          ? "https://example.atlassian.net"
          : name === "JIRA_EMAIL"
            ? "dev@example.com"
            : name === "JIRA_API_TOKEN"
              ? "abc"
              : undefined,
      readSecret: () => null,
    });

    assert.equal(result.configured, true);
    assert.equal(result.values.baseURL.source, "environment");
  });

  test("uses the Jira API token from environment before persisted config", () => {
    const result = resolveServiceState("jira", {
      readEnv: (name) => name === "JIRA_API_TOKEN" ? "env-token" : undefined,
      readSecret: (_service, account) =>
        account === "base-url"
          ? "https://example.atlassian.net"
          : account === "email"
            ? "dev@example.com"
            : account === "api-token"
              ? "stored-token"
              : null,
    });

    assert.equal(result.configured, true);
    assert.equal(result.values.baseURL.source, "secret");
    assert.equal(result.values.apiToken.source, "environment");
    assert.equal(result.values.apiToken.value, "env-token");
  });

  test("uses non-secret environment values before persisted config", () => {
    const result = resolveServiceState("snyk", {
      readEnv: (name) =>
        name === "TRIAGE_COMPANION_SNYK_API_BASE_URL"
          ? "https://api.us.snyk.io/rest"
          : undefined,
      readSecret: (_service, account) =>
        account === "token"
          ? "token"
          : account === "snyk-api-base-url"
            ? "https://api.snyk.io/rest"
            : null,
    });

    assert.equal(result.configured, true);
    assert.equal(result.values.apiBaseURL.source, "environment");
    assert.equal(result.values.apiBaseURL.value, "https://api.us.snyk.io/rest");
  });

  test("surfaces stored secret read failures before environment credentials", () => {
    assert.throws(
      () => resolveServiceState("github", {
        readEnv: (name) => name === "GITHUB_TOKEN" ? "env-token" : undefined,
        readSecret: () => {
          throw new Error("credential store is not valid JSON");
        },
      }),
      /credential store is not valid JSON/,
    );
  });

  test("surfaces stored optional config read failures instead of defaulting", () => {
    assert.throws(
      () => resolveServiceState("snyk", {
        readEnv: (name) => name === "SNYK_TOKEN" ? "env-token" : undefined,
        readSecret: (_service, account) => {
          if (account === "token") {
            return null;
          }

          throw new Error("credential store is not valid JSON");
        },
      }),
      /credential store is not valid JSON/,
    );
  });

  test("ignores blank optional environment overrides that runtime treats as absent", () => {
    const git = resolveServiceState("git", {
      readEnv: (name) => name === "TRIAGE_COMPANION_GIT" ? "   " : undefined,
      readSecret: () => null,
    });
    assert.equal(git.configured, true);
    assert.equal(git.values.binary.source, "missing");

    const github = resolveServiceState("github", {
      readEnv: (name) => name === "GITHUB_TOKEN"
        ? "env-token"
        : name === "TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX"
          ? "   "
          : name === "TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES"
            ? "   "
            : undefined,
      readSecret: () => null,
    });
    assert.equal(github.configured, true);
    assert.equal(github.values.authorRegex.source, "missing");
    assert.equal(github.values.ignoredBranches.source, "default");
    assert.equal(github.values.ignoredBranches.value, "main\nmaster\nproduction");

    const snyk = resolveServiceState("snyk", {
      readEnv: (name) => name === "SNYK_TOKEN"
        ? "env-token"
        : name === "TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS"
          ? "   "
          : undefined,
      readSecret: () => null,
    });
    assert.equal(snyk.configured, true);
    assert.equal(snyk.values.organizationIds.source, "missing");

    const local = resolveServiceState("local", {
      readEnv: (name) => name === "TRIAGE_COMPANION_GIT_SEARCH_ROOTS"
        ? "   "
        : name === "TRIAGE_COMPANION_CONFIG_DIR"
          ? "   "
          : undefined,
      readSecret: () => null,
    });
    assert.equal(local.configured, true);
    assert.equal(local.values.searchRoots.source, "default");
    assert.equal(local.values.searchRoots.value, DEFAULT_SEARCH_ROOTS.join("\n"));
    assert.equal(local.values.configDirectory.source, "missing");
  });

  test("fails when required values are missing", () => {
    const result = resolveServiceState("github", {
      readEnv: () => undefined,
      readSecret: () => null,
    });

    assert.equal(result.configured, false);
    assert.equal(result.errors.length > 0, true);
    assert.equal(result.values.token.source, "missing");
  });

  test("keeps cross-platform-friendly default git search roots", () => {
    assert.deepEqual(DEFAULT_SEARCH_ROOTS, [
      "Projects",
      "repos",
      "workspace",
      "work",
      "code",
      "src",
    ]);
    const local = getServiceDefinition("local");
    const searchRoots = local.optionalSettings.find((field) => field.key === "searchRoots");
    assert.deepEqual(searchRoots?.defaultValues, [...DEFAULT_SEARCH_ROOTS]);
  });
});

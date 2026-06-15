import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildConfigurationSummary } from "./config-summary.ts";
import { ENV } from "./config.ts";
import { setupConfigSummaryTest } from "./config-summary-test-support.ts";

setupConfigSummaryTest();

describe("configuration summary display values", () => {
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

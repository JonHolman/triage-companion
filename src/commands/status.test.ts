import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Command } from "commander";
import os from "node:os";
import path from "node:path";

import {
  buildStatusReport,
  type StatusDependencies,
  register,
} from "./status.ts";
import { listServiceDefinitions, resolveServiceState } from "../config-model.ts";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("status command", () => {
  test("formats a status report with configured and missing services", () => {
    const credentialsPath = path.join(os.tmpdir(), "triage", "credentials.json");
    const deps: StatusDependencies = {
      hasGitHubToken: () => true,
      hasSnykToken: () => false,
      hasJiraCredentials: () => false,
      gitBinary: () => "/usr/bin/git",
      credentialsPath: () => credentialsPath,
    };

    const report = buildStatusReport(deps);

    const output = stripAnsi(report);
    assert.match(output, /Service Status/);
    assert.match(output, /✓ GitHub/);
    assert.match(output, /✗ Snyk/);
    assert.match(output, /✗ Jira/);
    assert.ok(output.includes(`Credentials are stored in ${credentialsPath}`));
  });

  test("reports all configured model services in one place", () => {
    const credentialsPath = path.join(os.tmpdir(), "triage", "credentials.json");
    const deps: StatusDependencies = {
      hasGitHubToken: () => true,
      hasSnykToken: () => true,
      hasJiraCredentials: () => true,
      gitBinary: () => "/usr/bin/git",
      credentialsPath: () => credentialsPath,
    };

    const report = buildStatusReport(deps);
    const output = stripAnsi(report);

    for (const service of listServiceDefinitions().filter((item) => item.id !== "local")) {
      const icon = "✓";
      assert.match(output, new RegExp(`${icon} ${service.name}`));
      assert.ok(!output.includes(`Set up: ${service.status.saveHint}`));
    }

    assert.ok(!output.includes("not available"));
    assert.ok(output.includes("Credentials are stored in"));
    assert.ok(output.includes(`Credentials are stored in ${credentialsPath}`));
  });

  test("reports missing services with per-service guidance", () => {
    const deps: StatusDependencies = {
      hasGitHubToken: () => false,
      hasSnykToken: () => false,
      hasJiraCredentials: () => false,
      gitBinary: () => null,
      credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
    };
    const report = buildStatusReport(deps);
    const output = stripAnsi(report);
    assert.match(output, /Permissions needed:/);

    for (const service of listServiceDefinitions().filter((item) => item.id !== "local")) {
      const configLabel = service.id === "git" ? service.status.missingLabel : "not configured";
      assert.match(output, new RegExp(`✗ ${service.name}: ${configLabel}`));
      assert.match(
        output,
        new RegExp(`Set up: ${service.status.saveHint.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`),
      );
      assert.match(
        output,
        new RegExp(`Or env: ${service.status.envHint.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`),
      );

      for (const requirement of service.status.permissionRequirements) {
        assert.match(
          output,
          new RegExp(`${requirement.feature}: ${requirement.permissions.join(", ").replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`),
        );
      }
    }
  });

  test("reports central configuration validation errors", () => {
    const deps: StatusDependencies = {
      hasGitHubToken: () => true,
      hasSnykToken: () => true,
      hasJiraCredentials: () => true,
      gitBinary: () => "/usr/bin/git",
      credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
      validationErrors: (serviceId) =>
        serviceId === "snyk" ? ["API base URL is invalid: must be US-hosted"] : [],
    };

    const output = stripAnsi(buildStatusReport(deps));

    assert.match(output, /✗ Snyk: not configured/);
    assert.match(output, /Configuration errors:/);
    assert.match(output, /API base URL is invalid: must be US-hosted/);
  });

  test("reports invalid local git search root configuration under Git", () => {
    const deps: StatusDependencies = {
      hasGitHubToken: () => true,
      hasSnykToken: () => true,
      hasJiraCredentials: () => true,
      gitBinary: () => "/usr/bin/git",
      credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
      validationErrors: (serviceId) =>
        serviceId === "local"
          ? ["Git search roots is invalid: must be a JSON array of non-empty strings"]
          : [],
    };

    const output = stripAnsi(buildStatusReport(deps));

    assert.match(output, /✗ Git: not available/);
    assert.match(output, /Git search roots is invalid: must be a JSON array of non-empty strings/);
  });

  test("reports blank stored git search root config under Git", () => {
    const output = stripAnsi(
      buildStatusReport({
        hasGitHubToken: () => true,
        hasSnykToken: () => true,
        hasJiraCredentials: () => true,
        gitBinary: () => "/usr/bin/git",
        credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
        validationErrors: (serviceId) =>
          serviceId === "local"
            ? resolveServiceState("local", {
                readEnv: () => undefined,
                readSecret: (_service, account) =>
                  account === "git-search-roots" ? "" : null,
              }).errors
            : [],
      }),
    );

    assert.match(output, /✗ Git: not available/);
    assert.match(output, /Git search roots is invalid: must be a JSON array of non-empty strings/);
  });

  test("reports credentials path resolution failures without crashing", () => {
    const deps: StatusDependencies = {
      hasGitHubToken: () => true,
      hasSnykToken: () => true,
      hasJiraCredentials: () => true,
      gitBinary: () => "/usr/bin/git",
      credentialsPath: () => {
        throw new Error("TRIAGE_COMPANION_CONFIG_DIR is invalid: must not include surrounding whitespace.");
      },
      validationErrors: () => [],
    };

    const output = stripAnsi(buildStatusReport(deps));

    assert.match(output, /✓ Git: available/);
    assert.match(
      output,
      /Credentials file unavailable: TRIAGE_COMPANION_CONFIG_DIR is invalid: must not include surrounding whitespace\./,
    );
  });

  test("escapes control characters in validation errors", () => {
    const output = stripAnsi(
      buildStatusReport({
        hasGitHubToken: () => true,
        hasSnykToken: () => true,
        hasJiraCredentials: () => true,
        gitBinary: () => "/usr/bin/git",
        credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
        validationErrors: (serviceId) =>
          serviceId === "snyk" ? ["bad\tconfig\nretry"] : [],
      }),
    );

    assert.match(output, /Configuration errors:/);
    assert.match(output, /bad\\tconfig, retry/);
    assert.equal(output.includes("\t"), false);
    assert.equal(output.includes("bad\tconfig"), false);
  });

  test("escapes control characters in credentials path errors", () => {
    const output = stripAnsi(
      buildStatusReport({
        hasGitHubToken: () => true,
        hasSnykToken: () => true,
        hasJiraCredentials: () => true,
        gitBinary: () => "/usr/bin/git",
        credentialsPath: () => {
          throw new Error("bad\tpath\nretry");
        },
        validationErrors: () => [],
      }),
    );

    assert.match(output, /Credentials file unavailable: bad\\tpath, retry/);
    assert.equal(output.includes("\t"), false);
  });

  test("ignores blank optional environment overrides that runtime treats as absent", () => {
    const originalGitBinary = process.env.TRIAGE_COMPANION_GIT;
    try {
      process.env.TRIAGE_COMPANION_GIT = "   ";

      const deps: StatusDependencies = {
        hasGitHubToken: () => true,
        hasSnykToken: () => true,
        hasJiraCredentials: () => true,
        gitBinary: () => "/usr/bin/git",
        credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
        validationErrors: (serviceId) =>
          serviceId === "git"
            ? resolveServiceState("git", {
                readEnv: (name) => process.env[name],
                readSecret: () => null,
              }).errors
            : [],
      };

      const output = stripAnsi(buildStatusReport(deps));

      assert.match(output, /✓ Git: available/);
      assert.doesNotMatch(output, /Git binary is invalid/);
    } finally {
      if (originalGitBinary === undefined) {
        delete process.env.TRIAGE_COMPANION_GIT;
      } else {
        process.env.TRIAGE_COMPANION_GIT = originalGitBinary;
      }
    }
  });

  test("reports invalid Snyk organization ID whitespace under Snyk", () => {
    const originalOrganizationIDs = process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS;
    process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = "org-1, org-2";

    try {
      const deps: StatusDependencies = {
        hasGitHubToken: () => true,
        hasSnykToken: () => true,
        hasJiraCredentials: () => true,
        gitBinary: () => "/usr/bin/git",
        credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
        validationErrors: (serviceId) =>
          serviceId === "snyk"
            ? resolveServiceState("snyk", {
                readEnv: (name) => process.env[name],
                readSecret: () => null,
              }).errors
            : [],
      };

      const output = stripAnsi(buildStatusReport(deps));

      assert.match(output, /✗ Snyk: not configured/);
      assert.match(output, /Organization IDs is invalid: must contain IDs without surrounding whitespace/);
    } finally {
      if (originalOrganizationIDs === undefined) {
        delete process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS;
      } else {
        process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = originalOrganizationIDs;
      }
    }
  });

  test("does not call service configuration checks when validation already failed", () => {
    const deps: StatusDependencies = {
      hasGitHubToken: () => false,
      hasSnykToken: () => false,
      hasJiraCredentials: () => {
        throw new Error("Jira runtime validation should not run");
      },
      gitBinary: () => "/usr/bin/git",
      credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
      validationErrors: (serviceId) =>
        serviceId === "jira" ? ["Base URL is invalid: must use https://"] : [],
    };

    const output = stripAnsi(buildStatusReport(deps));

    assert.match(output, /✗ Jira: not configured/);
    assert.match(output, /Base URL is invalid: must use https:\/\//);
  });

  test("reports configuration validation exceptions as status errors", () => {
    const deps: StatusDependencies = {
      hasGitHubToken: () => {
        throw new Error("GitHub runtime validation should not run");
      },
      hasSnykToken: () => false,
      hasJiraCredentials: () => false,
      gitBinary: () => null,
      credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
      validationErrors: (serviceId) =>
        serviceId === "github" ? (() => { throw new Error("Credential store is not valid JSON"); })() : [],
    };

    const output = stripAnsi(buildStatusReport(deps));

    assert.match(output, /✗ GitHub: not configured/);
    assert.match(output, /Credential store is not valid JSON/);
  });

  test("reports local configuration exceptions under Git instead of claiming availability", () => {
    const deps: StatusDependencies = {
      hasGitHubToken: () => false,
      hasSnykToken: () => false,
      hasJiraCredentials: () => false,
      gitBinary: () => "/usr/bin/git",
      credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
      validationErrors: (serviceId) =>
        serviceId === "local"
          ? (() => { throw new Error("Credential store is not valid JSON"); })()
          : [],
    };

    const output = stripAnsi(buildStatusReport(deps));

    assert.match(output, /✗ Git: not available/);
    assert.match(output, /Credential store is not valid JSON/);
  });

  test("registers the status subcommand", () => {
    const program = new Command();
    const deps: StatusDependencies = {
      hasGitHubToken: () => false,
      hasSnykToken: () => false,
      hasJiraCredentials: () => false,
      gitBinary: () => null,
      credentialsPath: () => path.join(os.tmpdir(), "triage", "credentials.json"),
    };

    register(program, deps);

    const command = program.commands.find((item) => item.name() === "status");
    assert.ok(command);
    assert.equal(command?.description(), "Show configuration and availability status for all services");
  });
});

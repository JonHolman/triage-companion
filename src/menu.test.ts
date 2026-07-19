import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import * as github from "./clients/github.ts";
import * as jira from "./clients/jira.ts";
import * as snyk from "./clients/snyk.ts";
import { ENV } from "./config-model.ts";
import { SUPPRESS_ACTIVITY_ENV } from "./commands/command-utils.ts";
import { buildConfigurationSummary } from "./config-summary.ts";
import {
  buildMenuTree,
  isMenuInterruptKey,
  MenuActionReportedError,
  runMenuAction,
} from "./menu.ts";

interface TestMenuItem {
  label: string;
  action?: () => Promise<void> | void;
  submenu?: TestMenuNode;
}

interface TestMenuNode {
  items: TestMenuItem[];
}

function collectLabels(): string[] {
  const labels: string[] = [];
  const walk = (node: TestMenuNode): void => {
    for (const item of node.items) {
      labels.push(item.label);
      if (item.submenu) {
        walk(item.submenu);
      }
    }
  };

  walk(buildMenuTree());
  return labels;
}

async function withIsolatedCredentialConfig(action: () => Promise<void> | void): Promise<void> {
  const originalEnv = {
    configDir: process.env[ENV.CONFIG_DIR],
    githubToken: process.env[ENV.GITHUB_TOKEN],
    snykToken: process.env[ENV.SNYK_TOKEN],
    jiraBaseURL: process.env[ENV.JIRA_BASE_URL],
    jiraEmail: process.env[ENV.JIRA_EMAIL],
    jiraToken: process.env[ENV.JIRA_API_TOKEN],
    jiraCloudID: process.env[ENV.JIRA_CLOUD_ID],
  };
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-menu-credentials-"));
  process.env[ENV.CONFIG_DIR] = testDir;
  delete process.env[ENV.GITHUB_TOKEN];
  delete process.env[ENV.SNYK_TOKEN];
  delete process.env[ENV.JIRA_BASE_URL];
  delete process.env[ENV.JIRA_EMAIL];
  delete process.env[ENV.JIRA_API_TOKEN];
  delete process.env[ENV.JIRA_CLOUD_ID];

  try {
    await action();
  } finally {
    if (originalEnv.configDir === undefined) {
      delete process.env[ENV.CONFIG_DIR];
    } else {
      process.env[ENV.CONFIG_DIR] = originalEnv.configDir;
    }
    if (originalEnv.githubToken === undefined) {
      delete process.env[ENV.GITHUB_TOKEN];
    } else {
      process.env[ENV.GITHUB_TOKEN] = originalEnv.githubToken;
    }
    if (originalEnv.snykToken === undefined) {
      delete process.env[ENV.SNYK_TOKEN];
    } else {
      process.env[ENV.SNYK_TOKEN] = originalEnv.snykToken;
    }
    if (originalEnv.jiraBaseURL === undefined) {
      delete process.env[ENV.JIRA_BASE_URL];
    } else {
      process.env[ENV.JIRA_BASE_URL] = originalEnv.jiraBaseURL;
    }
    if (originalEnv.jiraEmail === undefined) {
      delete process.env[ENV.JIRA_EMAIL];
    } else {
      process.env[ENV.JIRA_EMAIL] = originalEnv.jiraEmail;
    }
    if (originalEnv.jiraToken === undefined) {
      delete process.env[ENV.JIRA_API_TOKEN];
    } else {
      process.env[ENV.JIRA_API_TOKEN] = originalEnv.jiraToken;
    }
    if (originalEnv.jiraCloudID === undefined) {
      delete process.env[ENV.JIRA_CLOUD_ID];
    } else {
      process.env[ENV.JIRA_CLOUD_ID] = originalEnv.jiraCloudID;
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

function submenuLabels(label: string): string[] {
  const submenu = buildMenuTree().items.find((item) => item.label === label)?.submenu;
  assert.ok(submenu);
  return submenu.items.map((item) => item.label);
}

describe("menu", () => {
  test("includes base CLI areas and configuration actions", async () => {
    await withIsolatedCredentialConfig(() => {
      const labels = collectLabels();

      assert.ok(labels.includes("Status"));
      assert.ok(labels.includes("GitHub"));
      assert.ok(labels.includes("Git"));
      assert.ok(labels.includes("Configuration"));
      assert.ok(labels.includes("List my open PRs"));
      assert.ok(labels.includes("List my open PRs with login override"));
      assert.ok(labels.includes("List my open PRs with author regex"));
      assert.ok(labels.includes("List dirty repositories"));
      assert.ok(labels.includes("View configuration"));
      assert.ok(labels.includes("Set or replace GitHub token"));
      assert.ok(labels.includes("Remove GitHub token"));
      assert.ok(labels.includes("Set or replace Snyk token"));
      assert.ok(labels.includes("Remove Snyk token"));
      assert.ok(labels.includes("Set Snyk API base URL"));
      assert.ok(labels.includes("Reset Snyk API base URL"));
      assert.ok(labels.includes("Set or replace Jira credentials"));
      assert.ok(labels.includes("Remove Jira credentials"));
      assert.ok(labels.includes("Edit git search roots"));
      assert.ok(labels.includes("Reset git search roots"));
      assert.equal(labels.includes("List notifications"), false);
      assert.equal(labels.includes("List security alerts"), false);
      assert.equal(labels.includes("List failed workflows"), false);
      assert.equal(labels.includes("Snyk"), false);
      assert.equal(labels.includes("Jira"), false);
    });
  });

  test("shows token-backed service menu actions only when configured", async () => {
    await withIsolatedCredentialConfig(() => {
      assert.equal(buildMenuTree().items.some((item) => item.label === "GitHub"), true);
      assert.deepEqual(submenuLabels("GitHub"), [
        "List my open PRs",
        "List my open PRs with login override",
        "List my open PRs with author regex",
        "Back",
      ]);
      assert.equal(buildMenuTree().items.some((item) => item.label === "Snyk"), false);
      assert.equal(buildMenuTree().items.some((item) => item.label === "Jira"), false);

      github.saveToken("github-token");
      snyk.saveToken("snyk-token");
      jira.saveCredentials("https://example.atlassian.net", "dev@example.com", "jira-token");

      assert.equal(submenuLabels("GitHub")[0], "List notifications");
      assert.equal(submenuLabels("Snyk")[0], "List issues");
      assert.deepEqual(submenuLabels("Jira"), [
        "List tickets",
        "Create ticket",
        "Comment on ticket",
        "Assign ticket to sprint",
        "Change ticket status",
        "Back",
      ]);
    });
  });

  test("root menu can refresh after credentials change", async () => {
    await withIsolatedCredentialConfig(() => {
      const rootMenu = buildMenuTree();
      assert.ok(rootMenu.refresh);
      assert.equal(submenuLabels("GitHub")[0], "List my open PRs");

      github.saveToken("github-token");
      const refreshed = rootMenu.refresh();
      const githubMenu = refreshed.items.find((item) => item.label === "GitHub")?.submenu;
      assert.equal(githubMenu?.items[0]?.label, "List notifications");
    });
  });

  test("keeps menu actions recoverable after errors", async () => {
    const originalStderrWrite = process.stderr.write;
    const messages: string[] = [];

    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction({
        label: "Broken",
        action: () => {
          throw new Error("broken menu action");
        },
      });
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    assert.match(messages.join(""), /triage-companion menu error: broken menu action/);
  });

  test("escapes control characters in menu action errors", async () => {
    const originalStderrWrite = process.stderr.write;
    const messages: string[] = [];

    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction({
        label: "Broken",
        action: () => {
          throw new Error("broken\tmenu\naction");
        },
      });
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    assert.match(messages.join(""), /triage-companion menu error: broken\\tmenu, action/);
  });

  test("does not duplicate already-reported command failures", async () => {
    const originalStderrWrite = process.stderr.write;
    const messages: string[] = [];

    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runMenuAction({
        label: "Reported",
        action: () => {
          throw new MenuActionReportedError("triage-companion snyk issues exited with status 1.");
        },
      });
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    assert.equal(messages.join(""), "");
  });

  test("treats ctrl-c as an interactive menu interrupt", () => {
    assert.equal(isMenuInterruptKey({ ctrl: true, name: "c" }), true);
    assert.equal(isMenuInterruptKey({ ctrl: false, name: "c" }), false);
    assert.equal(isMenuInterruptKey({ ctrl: true, name: "x" }), false);
  });

  test("prints configuration from the menu without an extra blank line", async () => {
    const menu = buildMenuTree();
    const configurationMenu = menu.items.find((item) => item.label === "Configuration")?.submenu;
    const viewConfiguration = configurationMenu?.items.find((item) => item.label === "View configuration");

    assert.ok(viewConfiguration?.action);

    const originalStdoutWrite = process.stdout.write;
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await viewConfiguration.action();
    } finally {
      process.stdout.write = originalStdoutWrite;
    }

    assert.equal(output, buildConfigurationSummary());
  });

  test("menu spawned commands print activity dots while the child is running", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const originalSpawn = childProcess.spawn;
    const originalStderrWrite = process.stderr.write;
    const originalTTYDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    const messages: string[] = [];
    const children: EventEmitter[] = [];
    let childEnv: NodeJS.ProcessEnv | undefined;

    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });
    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    childProcess.spawn = ((_command, _args, options) => {
      const child = new EventEmitter();
      children.push(child);
      childEnv = options?.env;
      return child as ReturnType<typeof childProcess.spawn>;
    }) as typeof childProcess.spawn;
    syncBuiltinESMExports();

    try {
      const menu = buildMenuTree();
      const gitMenu = menu.items.find((item) => item.label === "Git")?.submenu;
      const listDirtyRepositories = gitMenu?.items.find((item) => item.label === "List dirty repositories");
      assert.ok(listDirtyRepositories?.action);

      const pending = Promise.resolve(listDirtyRepositories.action());
      await Promise.resolve();
      assert.equal(childEnv?.[SUPPRESS_ACTIVITY_ENV], "1");

      t.mock.timers.tick(750);
      assert.equal(messages.join("").replace(/\x1b\[[0-9;]*m/g, ""), "Still running: git dirty");
      t.mock.timers.tick(1000);
      assert.equal(messages.join("").replace(/\x1b\[[0-9;]*m/g, ""), "Still running: git dirty.");

      const activeChild = children[0];
      assert.ok(activeChild);
      activeChild.emit("close", 0, null);
      await pending;
      assert.equal(messages.join("").replace(/\x1b\[[0-9;]*m/g, ""), "Still running: git dirty.\n");
    } finally {
      process.stderr.write = originalStderrWrite;
      if (originalTTYDescriptor) {
        Object.defineProperty(process.stderr, "isTTY", originalTTYDescriptor);
      } else {
        delete (process.stderr as { isTTY?: boolean }).isTTY;
      }
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
    }
  });

  test("menu spawned commands wrap nonzero exit in MenuActionReportedError", async () => {
    const originalSpawn = childProcess.spawn;
    const children: EventEmitter[] = [];

    childProcess.spawn = ((_command, _args, _options) => {
      const child = new EventEmitter();
      children.push(child);
      return child as ReturnType<typeof childProcess.spawn>;
    }) as typeof childProcess.spawn;
    syncBuiltinESMExports();

    try {
      const menu = buildMenuTree();
      const gitMenu = menu.items.find((item) => item.label === "Git")?.submenu;
      const listDirtyRepositories = gitMenu?.items.find((item) => item.label === "List dirty repositories");
      assert.ok(listDirtyRepositories?.action);

      const pending = Promise.resolve(listDirtyRepositories.action());
      await Promise.resolve();

      children[0]?.emit("close", 1, null);

      await assert.rejects(
        () => pending,
        (error: unknown) => {
          assert.ok(
            error instanceof MenuActionReportedError,
            `expected MenuActionReportedError, got ${error instanceof Error ? error.constructor.name : String(error)}`,
          );
          assert.match((error as Error).message, /exited with status 1/);
          return true;
        },
      );
    } finally {
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
    }
  });
});

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { afterEach, describe, test } from "node:test";

import * as github from "./clients/github.ts";
import * as jira from "./clients/jira.ts";
import * as snyk from "./clients/snyk.ts";
import { resetCache } from "./credential-store.ts";
import { ENV } from "./config-model.ts";
import { SUPPRESS_ACTIVITY_ENV } from "./commands/command-utils.ts";
import { buildConfigurationSummary } from "./config-summary.ts";
import { ESCAPE } from "./menu-keys.ts";
import { setMenuListActionClientsForTest } from "./menu-list-actions.ts";
import {
  buildMenuTree,
  ESCAPE_KEY_TIMEOUT_MS,
  isMenuInterruptKey,
  MenuActionReportedError,
  readMenuKey,
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
  resetCache();

  try {
    await action();
  } finally {
    resetCache();
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

function credentialLabels(label: string): string[] {
  const submenu = buildMenuTree().items.find((item) => item.label === label)?.submenu;
  const credentials = submenu?.items.find((item) => item.label === "Credentials")?.submenu;
  assert.ok(credentials);
  return credentials.items.map((item) => item.label);
}

describe("menu", () => {
  test("includes all major CLI areas", () => {
    const labels = collectLabels();

    assert.ok(labels.includes("Status"));
    assert.ok(labels.includes("GitHub"));
    assert.ok(labels.includes("Snyk"));
    assert.ok(labels.includes("Jira"));
    assert.ok(labels.includes("Git"));
    assert.ok(labels.includes("Configuration"));
    assert.ok(labels.includes("List notifications"));
    assert.ok(labels.includes("List security alerts"));
    assert.ok(labels.includes("List failed workflows"));
    assert.ok(labels.includes("List my open PRs with login override"));
    assert.ok(labels.includes("List my open PRs with author regex"));
    assert.ok(labels.includes("List issues"));
    assert.ok(labels.includes("List issues by severity"));
    assert.ok(labels.includes("Set API base URL"));
    assert.ok(labels.includes("Reset API base URL"));
    assert.ok(labels.includes("List tickets"));
    assert.ok(labels.includes("List dirty repositories"));
    assert.ok(labels.includes("View configuration"));
    assert.ok(labels.includes("Edit git search roots"));
    assert.ok(labels.includes("Reset git search roots"));
    assert.ok(labels.includes("Credentials"));
    assert.ok(labels.includes("Set or replace token"));
    assert.ok(labels.includes("Remove token"));
    assert.ok(labels.includes("Remove credentials"));
  });

  test("keeps credential actions inside service credentials submenus", async () => {
    await withIsolatedCredentialConfig(() => {
      assert.equal(submenuLabels("GitHub")[0], "Credentials");
      assert.deepEqual(credentialLabels("GitHub"), ["Set or replace token", "Remove token", "Back"]);
      assert.deepEqual(
        credentialLabels("Snyk"),
        ["Set or replace token", "Set API base URL", "Reset API base URL", "Remove token", "Back"],
      );
      assert.deepEqual(credentialLabels("Jira"), ["Set or replace credentials", "Remove credentials", "Back"]);
    });
  });

  test("keeps work actions first for configured service menus", async () => {
    await withIsolatedCredentialConfig(() => {
      github.saveToken("github-token");
      snyk.saveToken("snyk-token");
      jira.saveCredentials("https://example.atlassian.net", "dev@example.com", "jira-token");

      assert.equal(submenuLabels("GitHub")[0], "List notifications");
      assert.equal(submenuLabels("Snyk")[0], "List issues");
      assert.equal(submenuLabels("Jira")[0], "List tickets");
    });
  });

  test("service submenus can refresh after credentials change", async () => {
    await withIsolatedCredentialConfig(() => {
      const githubMenu = buildMenuTree().items.find((item) => item.label === "GitHub")?.submenu;
      assert.ok(githubMenu?.refresh);
      assert.equal(githubMenu.items[0]?.label, "Credentials");

      github.saveToken("github-token");
      const refreshed = githubMenu.refresh();
      assert.equal(refreshed.items[0]?.label, "List notifications");
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

  test("menu login override treats whitespace-only input as cancel", async () => {
    let listCalls = 0;
    const restore = setMenuListActionClientsForTest({
      github: {
        listMyOpenPullRequests: async () => {
          listCalls += 1;
          return [];
        },
      },
    });

    const originalCreateInterface = readline.createInterface;
    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("   "),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const githubMenu = menu.items.find((item) => item.label === "GitHub")?.submenu;
    const listWithLogin = githubMenu?.items.find((item) => item.label === "List my open PRs with login override");

    assert.ok(listWithLogin?.action);

    try {
      await listWithLogin.action();
    } finally {
      readline.createInterface = originalCreateInterface;
      restore();
    }

    assert.equal(listCalls, 0);
  });

  test("menu author regex override treats whitespace-only input as cancel", async () => {
    let listCalls = 0;
    const restore = setMenuListActionClientsForTest({
      github: {
        listMyOpenPullRequests: async () => {
          listCalls += 1;
          return [];
        },
      },
    });

    const originalCreateInterface = readline.createInterface;
    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("   "),
      close: () => undefined,
      once: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const githubMenu = menu.items.find((item) => item.label === "GitHub")?.submenu;
    const listWithRegex = githubMenu?.items.find((item) => item.label === "List my open PRs with author regex");

    assert.ok(listWithRegex?.action);

    try {
      await listWithRegex.action();
    } finally {
      readline.createInterface = originalCreateInterface;
      restore();
    }

    assert.equal(listCalls, 0);
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

      const pending = listDirtyRepositories.action();
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

      const pending = listDirtyRepositories.action();
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

describe("readMenuKey stdin handling", { concurrency: false }, () => {
  afterEach(() => {
    process.stdin.removeAllListeners("data");
    process.stdin.pause();
  });

  function emitStdin(data: string): void {
    process.stdin.emit("data", Buffer.from(data));
  }

  test("resolves a lingering bare ESC to the escape key only after the quiet period", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let settled = false;
    const pending = readMenuKey().then((key) => {
      settled = true;
      return key;
    });

    emitStdin(ESCAPE);
    await Promise.resolve();
    assert.equal(settled, false);

    t.mock.timers.tick(ESCAPE_KEY_TIMEOUT_MS - 1);
    await Promise.resolve();
    assert.equal(settled, false);

    t.mock.timers.tick(1);
    assert.deepEqual(await pending, { name: "escape", sequence: ESCAPE });
  });

  test("reassembles a bare ESC and [A split across stdin chunks into a single up key", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const firstKey = readMenuKey();
    emitStdin(ESCAPE);
    emitStdin("[A");
    assert.deepEqual(await firstKey, { name: "up", sequence: `${ESCAPE}[A` });

    // Completing the arrow cleared the pending bare-ESC timer, so advancing the
    // clock must not deliver a phantom escape or leave a stray stdin listener
    // that would hijack the following read.
    t.mock.timers.tick(ESCAPE_KEY_TIMEOUT_MS);

    const secondKey = readMenuKey();
    emitStdin("q");
    assert.deepEqual(await secondKey, { name: "q", sequence: "q" });
  });

  test("returns input typed ahead of the resolved key to stdin for the next reader", async () => {
    const key = readMenuKey();
    emitStdin("\r12345\r");

    assert.deepEqual(await key, { name: "return", sequence: "\r" });
    assert.equal(String(process.stdin.read() ?? ""), "12345\r");
  });

  test("clears pending input after the escape timeout so it does not leak into the next read", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    const firstKey = readMenuKey();
    emitStdin(ESCAPE);
    t.mock.timers.tick(ESCAPE_KEY_TIMEOUT_MS);
    assert.deepEqual(await firstKey, { name: "escape", sequence: ESCAPE });

    const secondKey = readMenuKey();
    emitStdin("q");
    assert.deepEqual(await secondKey, { name: "q", sequence: "q" });
  });
});

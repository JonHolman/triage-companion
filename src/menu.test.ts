import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import readline from "node:readline";
import { describe, test } from "node:test";

import { buildConfigurationSummary } from "./config-summary.ts";
import { buildMenuTree, isMenuInterruptKey, MenuActionReportedError, runMenuAction } from "./menu.ts";

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
    assert.ok(labels.includes("Set token"));
    assert.ok(labels.includes("Replace token"));
    assert.ok(labels.includes("Remove token"));
    assert.ok(labels.includes("Remove credentials"));
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
    const originalCreateInterface = readline.createInterface;
    const originalSpawnSync = childProcess.spawnSync;
    let spawnCalls = 0;

    childProcess.spawnSync = ((..._args: Parameters<typeof childProcess.spawnSync>) => {
      spawnCalls += 1;
      return {
        error: undefined,
        signal: null,
        status: 0,
      } as unknown as ReturnType<typeof childProcess.spawnSync>;
    }) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("   "),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const githubMenu = menu.items.find((item) => item.label === "GitHub")?.submenu;
    const listWithLogin = githubMenu?.items.find((item) => item.label === "List my open PRs with login override");

    assert.ok(listWithLogin?.action);

    try {
      await listWithLogin.action();
    } finally {
      readline.createInterface = originalCreateInterface;
      childProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
    }

    assert.equal(spawnCalls, 0);
  });

  test("menu author regex override treats whitespace-only input as cancel", async () => {
    const originalCreateInterface = readline.createInterface;
    const originalSpawnSync = childProcess.spawnSync;
    let spawnCalls = 0;

    childProcess.spawnSync = ((..._args: Parameters<typeof childProcess.spawnSync>) => {
      spawnCalls += 1;
      return {
        error: undefined,
        signal: null,
        status: 0,
      } as unknown as ReturnType<typeof childProcess.spawnSync>;
    }) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    readline.createInterface = ((() => ({
      question: (_prompt: string, callback: (value: string) => void) => callback("   "),
      close: () => undefined,
    })) as unknown) as typeof readline.createInterface;

    const menu = buildMenuTree();
    const githubMenu = menu.items.find((item) => item.label === "GitHub")?.submenu;
    const listWithRegex = githubMenu?.items.find((item) => item.label === "List my open PRs with author regex");

    assert.ok(listWithRegex?.action);

    try {
      await listWithRegex.action();
    } finally {
      readline.createInterface = originalCreateInterface;
      childProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
    }

    assert.equal(spawnCalls, 0);
  });
});

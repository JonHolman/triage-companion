import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import readline from "node:readline";
import { afterEach, describe, test } from "node:test";

import { buildConfigurationSummary } from "./config-summary.ts";
import { ESCAPE } from "./menu-keys.ts";
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
      childProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
    }

    assert.equal(spawnCalls, 0);
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

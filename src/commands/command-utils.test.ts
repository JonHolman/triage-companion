import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { inlineErrorText, parseLimit, runCommand } from "./command-utils.ts";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("command utilities", () => {
  test("parses positive integer limits", () => {
    assert.equal(parseLimit("25", "--limit"), 25);
  });

  test("rejects partial and non-positive limits", () => {
    assert.throws(() => parseLimit("2abc", "--limit"), /positive integer/);
    assert.throws(() => parseLimit("1.5", "--limit"), /positive integer/);
    assert.throws(() => parseLimit("0", "--limit"), /positive integer/);
    assert.throws(() => parseLimit("-1", "--limit"), /positive integer/);
    assert.throws(() => parseLimit("999999999999999999999", "--limit"), /positive integer/);
  });

  test("rejects limits with surrounding whitespace", () => {
    assert.throws(
      () => parseLimit(" 25 ", "--limit"),
      /--limit must not include surrounding whitespace/,
    );
  });

  test("escapes control characters in runCommand stderr output", async () => {
    const originalStderrWrite = process.stderr.write;
    const messages: string[] = [];

    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runCommand("test command", () => {
        throw new Error("bad\tinput\nretry");
      });
    } finally {
      process.stderr.write = originalStderrWrite;
      process.exitCode = undefined;
    }

    assert.match(messages.join(""), /triage-companion error in test command: bad\\tinput, retry/);
  });

  test("prints activity dots for slow interactive commands", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const originalStderrWrite = process.stderr.write;
    const originalTTYDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    const messages: string[] = [];
    let finishAction = (): void => {
      throw new Error("finish callback was not assigned.");
    };

    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });
    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const command = runCommand("slow command", () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        })
      );

      t.mock.timers.tick(749);
      assert.equal(messages.join(""), "");
      t.mock.timers.tick(1);
      assert.equal(stripAnsi(messages.join("")), "Still running: slow command");
      t.mock.timers.tick(1000);
      assert.equal(stripAnsi(messages.join("")), "Still running: slow command.");
      t.mock.timers.tick(1000);
      assert.equal(stripAnsi(messages.join("")), "Still running: slow command..");

      finishAction();
      await command;
      assert.equal(stripAnsi(messages.join("")), "Still running: slow command..\n");
    } finally {
      process.stderr.write = originalStderrWrite;
      if (originalTTYDescriptor) {
        Object.defineProperty(process.stderr, "isTTY", originalTTYDescriptor);
      } else {
        delete (process.stderr as { isTTY?: boolean }).isTTY;
      }
      process.exitCode = undefined;
    }
  });

  test("can print activity before synchronous command work starts", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const originalStderrWrite = process.stderr.write;
    const originalTTYDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    const messages: string[] = [];

    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });
    process.stderr.write = ((chunk: string | Uint8Array) => {
      messages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await runCommand("sync command", () => undefined, { immediate: true });
      assert.equal(stripAnsi(messages.join("")), "Still running: sync command\n");
    } finally {
      process.stderr.write = originalStderrWrite;
      if (originalTTYDescriptor) {
        Object.defineProperty(process.stderr, "isTTY", originalTTYDescriptor);
      } else {
        delete (process.stderr as { isTTY?: boolean }).isTTY;
      }
      process.exitCode = undefined;
    }
  });

  test("escapes control characters in inlineErrorText", () => {
    assert.equal(inlineErrorText("bad\tinput\nretry"), "bad\\tinput, retry");
  });
});

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { afterEach, describe, test } from "node:test";

import { ESCAPE } from "./menu-keys.ts";
import { prompt, promptSecret, promptWithCancel } from "./menu-prompts.ts";

const originalCreateInterface = readline.createInterface;

function mockReadlineAnswer(answer: string): void {
  readline.createInterface = ((() => {
    const rl = new EventEmitter() as readline.Interface;
    Object.defineProperty(rl, "line", {
      configurable: true,
      value: answer,
    });
    rl.question = ((_text: string, callback: (value: string) => void) => callback(answer)) as typeof rl.question;
    rl.close = (() => {
      rl.emit("close");
    }) as typeof rl.close;
    return rl;
  }) as unknown) as typeof readline.createInterface;
}

describe("menu prompts", () => {
  afterEach(() => {
    readline.createInterface = originalCreateInterface;
  });

  test("q cancels text prompts", async () => {
    mockReadlineAnswer("q");

    assert.equal(await prompt("Value: "), "");
  });

  test("cancel-aware prompts keep blank input distinct from q", async () => {
    mockReadlineAnswer("");
    assert.equal(await promptWithCancel("Value: "), "");

    mockReadlineAnswer("q");
    assert.equal(await promptWithCancel("Value: "), null);
  });

  test("escape cancels secret prompts", async () => {
    mockReadlineAnswer(ESCAPE);

    assert.equal(await promptSecret("Secret: "), "");
  });

  test("escape cancels active tty text prompts without enter", async () => {
    const originalTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const originalRawDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isRaw");
    const originalSetRawMode = process.stdin.setRawMode;
    const rawModes: boolean[] = [];

    readline.createInterface = ((() => {
      const rl = new EventEmitter() as readline.Interface;
      rl.question = (() => undefined) as typeof rl.question;
      rl.close = (() => {
        rl.emit("close");
      }) as typeof rl.close;
      return rl;
    }) as unknown) as typeof readline.createInterface;
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdin, "isRaw", { configurable: true, value: false });
    process.stdin.setRawMode = ((mode: boolean) => {
      rawModes.push(mode);
      return process.stdin;
    }) as typeof process.stdin.setRawMode;

    try {
      const pending = prompt("Value: ");
      await Promise.resolve();
      process.stdin.emit("data", Buffer.from(ESCAPE));

      assert.equal(await pending, "");
      assert.deepEqual(rawModes, [true, false]);
    } finally {
      process.stdin.setRawMode = originalSetRawMode;
      if (originalTTYDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", originalTTYDescriptor);
      } else {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      }
      if (originalRawDescriptor) {
        Object.defineProperty(process.stdin, "isRaw", originalRawDescriptor);
      } else {
        delete (process.stdin as { isRaw?: boolean }).isRaw;
      }
    }
  });
});

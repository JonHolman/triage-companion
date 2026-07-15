import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { ESCAPE } from "./menu-keys.ts";
import {
  ESCAPE_KEY_TIMEOUT_MS,
  readMenuKey,
} from "./menu.ts";

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

    // Completing the arrow clears the pending bare-ESC timer, so advancing the
    // clock must not deliver a phantom escape or leave a stray stdin listener.
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

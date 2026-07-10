import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseMenuKeys } from "./menu-keys.ts";

describe("parseMenuKeys", () => {
  test("parses normal-mode arrow keys", () => {
    assert.deepEqual(parseMenuKeys("\u001b[A"), [{ name: "up", sequence: "\u001b[A" }]);
    assert.deepEqual(parseMenuKeys("\u001b[B"), [{ name: "down", sequence: "\u001b[B" }]);
  });

  test("parses application-cursor-mode arrow keys", () => {
    assert.deepEqual(parseMenuKeys("\u001bOA"), [{ name: "up", sequence: "\u001bOA" }]);
    assert.deepEqual(parseMenuKeys("\u001bOB"), [{ name: "down", sequence: "\u001bOB" }]);
  });

  test("ignores unrelated escape sequences instead of treating them as escape", () => {
    assert.deepEqual(parseMenuKeys("\u001b[C"), []);
    assert.deepEqual(parseMenuKeys("\u001b[D"), []);
    assert.deepEqual(parseMenuKeys("\u001b[15~"), []);
    assert.deepEqual(parseMenuKeys("\u001b[1;5H"), []);
    assert.deepEqual(parseMenuKeys("\u001bOP"), []);
  });

  test("parses a bare escape key", () => {
    assert.deepEqual(parseMenuKeys("\u001b"), [{ name: "escape", sequence: "\u001b" }]);
  });

  test("parses return, q, and control-c", () => {
    assert.deepEqual(parseMenuKeys("\r"), [{ name: "return", sequence: "\r" }]);
    assert.deepEqual(parseMenuKeys("\n"), [{ name: "return", sequence: "\n" }]);
    assert.deepEqual(parseMenuKeys("q"), [{ name: "q", sequence: "q" }]);
    assert.deepEqual(parseMenuKeys("\u0003"), [{ ctrl: true, name: "c", sequence: "\u0003" }]);
  });

  test("parses every key from a buffered chunk in order", () => {
    assert.deepEqual(parseMenuKeys("\u001b[B\u001b[B\r"), [
      { name: "down", sequence: "\u001b[B" },
      { name: "down", sequence: "\u001b[B" },
      { name: "return", sequence: "\r" },
    ]);
  });

  test("ignores unrecognized printable characters", () => {
    assert.deepEqual(parseMenuKeys("abc"), []);
    assert.deepEqual(parseMenuKeys("aqb\r"), [
      { name: "q", sequence: "q" },
      { name: "return", sequence: "\r" },
    ]);
  });

  test("keeps parsing after an unrelated escape sequence", () => {
    assert.deepEqual(parseMenuKeys("\u001b[C\u001b[A"), [{ name: "up", sequence: "\u001b[A" }]);
  });

  test("stops at a truncated escape sequence instead of misreading it", () => {
    assert.deepEqual(parseMenuKeys("\u001b["), []);
    assert.deepEqual(parseMenuKeys("\u001bO"), []);
    assert.deepEqual(parseMenuKeys("\u001b[1;5"), []);
  });
});

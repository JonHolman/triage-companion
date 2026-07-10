import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseMenuInput } from "./menu-keys.ts";

describe("parseMenuInput", () => {
  test("parses normal-mode arrow keys", () => {
    assert.deepEqual(parseMenuInput("\u001b[A"), {
      keys: [{ name: "up", sequence: "\u001b[A" }],
      remainder: "",
    });
    assert.deepEqual(parseMenuInput("\u001b[B"), {
      keys: [{ name: "down", sequence: "\u001b[B" }],
      remainder: "",
    });
  });

  test("parses application-cursor-mode arrow keys", () => {
    assert.deepEqual(parseMenuInput("\u001bOA"), {
      keys: [{ name: "up", sequence: "\u001bOA" }],
      remainder: "",
    });
    assert.deepEqual(parseMenuInput("\u001bOB"), {
      keys: [{ name: "down", sequence: "\u001bOB" }],
      remainder: "",
    });
  });

  test("ignores unrelated escape sequences instead of treating them as escape", () => {
    assert.deepEqual(parseMenuInput("\u001b[C"), { keys: [], remainder: "" });
    assert.deepEqual(parseMenuInput("\u001b[D"), { keys: [], remainder: "" });
    assert.deepEqual(parseMenuInput("\u001b[15~"), { keys: [], remainder: "" });
    assert.deepEqual(parseMenuInput("\u001b[1;5H"), { keys: [], remainder: "" });
    assert.deepEqual(parseMenuInput("\u001bOP"), { keys: [], remainder: "" });
  });

  test("returns a bare trailing escape as remainder for the caller to disambiguate", () => {
    assert.deepEqual(parseMenuInput("\u001b"), { keys: [], remainder: "\u001b" });
  });

  test("parses an escape followed by an unrelated character as the escape key", () => {
    assert.deepEqual(parseMenuInput("\u001bq"), {
      keys: [
        { name: "escape", sequence: "\u001b" },
        { name: "q", sequence: "q" },
      ],
      remainder: "",
    });
  });

  test("parses return, q, and control-c", () => {
    assert.deepEqual(parseMenuInput("\r"), {
      keys: [{ name: "return", sequence: "\r" }],
      remainder: "",
    });
    assert.deepEqual(parseMenuInput("\n"), {
      keys: [{ name: "return", sequence: "\n" }],
      remainder: "",
    });
    assert.deepEqual(parseMenuInput("q"), {
      keys: [{ name: "q", sequence: "q" }],
      remainder: "",
    });
    assert.deepEqual(parseMenuInput("\u0003"), {
      keys: [{ ctrl: true, name: "c", sequence: "\u0003" }],
      remainder: "",
    });
  });

  test("parses every key from a buffered chunk in order", () => {
    assert.deepEqual(parseMenuInput("\u001b[B\u001b[B\r"), {
      keys: [
        { name: "down", sequence: "\u001b[B" },
        { name: "down", sequence: "\u001b[B" },
        { name: "return", sequence: "\r" },
      ],
      remainder: "",
    });
  });

  test("ignores unrecognized printable characters", () => {
    assert.deepEqual(parseMenuInput("abc"), { keys: [], remainder: "" });
    assert.deepEqual(parseMenuInput("aqb\r"), {
      keys: [
        { name: "q", sequence: "q" },
        { name: "return", sequence: "\r" },
      ],
      remainder: "",
    });
  });

  test("keeps parsing after an unrelated escape sequence", () => {
    assert.deepEqual(parseMenuInput("\u001b[C\u001b[A"), {
      keys: [{ name: "up", sequence: "\u001b[A" }],
      remainder: "",
    });
  });

  test("returns a truncated escape sequence as remainder instead of misreading it", () => {
    assert.deepEqual(parseMenuInput("\u001b["), { keys: [], remainder: "\u001b[" });
    assert.deepEqual(parseMenuInput("\u001bO"), { keys: [], remainder: "\u001bO" });
    assert.deepEqual(parseMenuInput("\u001b[1;5"), { keys: [], remainder: "\u001b[1;5" });
  });

  test("parses an arrow key split across chunks once the remainder is carried over", () => {
    const first = parseMenuInput("\u001b");
    assert.deepEqual(first, { keys: [], remainder: "\u001b" });
    assert.deepEqual(parseMenuInput(`${first.remainder}[A`), {
      keys: [{ name: "up", sequence: "\u001b[A" }],
      remainder: "",
    });
  });

  test("keeps keys parsed before a truncated trailing sequence", () => {
    assert.deepEqual(parseMenuInput("\r\u001b["), {
      keys: [{ name: "return", sequence: "\r" }],
      remainder: "\u001b[",
    });
  });
});

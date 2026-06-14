import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { inlineErrorText, parseLimit, runCommand } from "./command-utils.ts";

describe("command utilities", () => {
  test("parses positive integer limits", () => {
    assert.equal(parseLimit(undefined, "--limit", 50), 50);
    assert.equal(parseLimit("25", "--limit", 50), 25);
  });

  test("rejects partial and non-positive limits", () => {
    assert.throws(() => parseLimit("2abc", "--limit", 50), /positive integer/);
    assert.throws(() => parseLimit("1.5", "--limit", 50), /positive integer/);
    assert.throws(() => parseLimit("0", "--limit", 50), /positive integer/);
    assert.throws(() => parseLimit("-1", "--limit", 50), /positive integer/);
    assert.throws(() => parseLimit("999999999999999999999", "--limit", 50), /positive integer/);
  });

  test("rejects limits with surrounding whitespace", () => {
    assert.throws(
      () => parseLimit(" 25 ", "--limit", 50),
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

  test("escapes control characters in inlineErrorText", () => {
    assert.equal(inlineErrorText("bad\tinput\nretry"), "bad\\tinput, retry");
  });
});

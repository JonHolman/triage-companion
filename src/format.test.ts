import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bold, dim, relativeTime, responsiveTable, severityColor, table } from "./format.ts";

describe("format utilities", () => {
  test("formats table output with headers and separators", () => {
    const output = table(
      [
        ["one", "two"],
        ["longer", "x"],
      ],
      { headers: ["A", "B"] },
    );

    assert.match(output, /^A\s+B/);
    assert.ok(output.includes("──────"));
  });

  test("keeps trailing columns aligned when a row has fewer cells than the headers", () => {
    const output = table(
      [
        ["one", "two"],
      ],
      { headers: ["A", "B", "C"] },
    );

    const lines = output.split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "A    B    C");
    assert.equal(lines[1], "───────────");
    assert.equal(lines[2], "one  two   ");
  });

  test("uses stacked rows when the table is too wide", () => {
    const output = responsiveTable(
      [[
        "https://example.com/very/long/item/link",
        "critical",
        "example-org",
      ]],
      {
        headers: ["Link", "Severity", "Org"],
        width: 20,
      },
    );

    assert.ok(output.includes("Link: https://example.com/very/long/item/link"));
    assert.ok(output.includes("Severity: critical"));
    assert.ok(output.includes("Org: example-org"));
  });

  test("uses stacked rows when indent makes the rendered table too wide", () => {
    const output = responsiveTable(
      [["abcd", "efgh"]],
      {
        headers: ["A", "B"],
        indent: 4,
        width: 11,
      },
    );

    assert.ok(output.includes("    A: abcd"));
    assert.ok(output.includes("    B: efgh"));
  });

  test("keeps trailing stacked fields when a row has fewer cells than the headers", () => {
    const output = responsiveTable(
      [["abcd", "efgh"]],
      {
        headers: ["A", "B", "C"],
        width: 6,
      },
    );

    assert.ok(output.includes("A: abcd"));
    assert.ok(output.includes("B: efgh"));
    assert.ok(output.includes("C: "));
  });

  test("reports relative times with units", () => {
    const now = new Date();
    const inMinutes = new Date(now.getTime() - 30 * 60 * 1000);
    const inHours = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const inDays = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const inFuture = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    assert.equal(relativeTime(inMinutes), "30m ago");
    assert.equal(relativeTime(inHours), "3h ago");
    assert.equal(relativeTime(inDays), "5d ago");
    assert.equal(relativeTime(inFuture), inFuture.toLocaleDateString());
  });

  test("supports ansi helpers", () => {
    assert.ok(bold("x").includes("\x1b[1m"));
    assert.ok(dim("x").includes("\x1b[2m"));
  });

  test("does not treat inherited object keys as severities", () => {
    assert.equal(severityColor("constructor", "constructor"), "constructor");
    assert.equal(severityColor("__proto__", "__proto__"), "__proto__");
  });
});

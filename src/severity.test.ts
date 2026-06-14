import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  normalizedKnownSeverity,
  severityRank,
  summarizeSeverities,
} from "./severity.ts";

describe("severity utilities", () => {
  test("normalizes known severities and rejects inherited object keys", () => {
    assert.equal(normalizedKnownSeverity(" HIGH "), "high");
    assert.equal(normalizedKnownSeverity("high"), "high");
    assert.equal(normalizedKnownSeverity("constructor"), null);
    assert.equal(normalizedKnownSeverity("__proto__"), null);
  });

  test("ranks only known severities", () => {
    assert.equal(severityRank("critical"), 4);
    assert.equal(severityRank("high"), 3);
    assert.equal(severityRank("constructor"), 0);
    assert.equal(severityRank("__proto__"), 0);
  });

  test("summarizes known severities without inherited-key matches", () => {
    assert.equal(
      summarizeSeverities(["critical", "HIGH", "constructor", "__proto__"]),
      "1 critical, 1 high",
    );
  });
});

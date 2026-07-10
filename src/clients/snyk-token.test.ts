import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { hasToken, listOpenIssues, saveToken } from "./snyk.ts";
import { resetCache, save } from "../credential-store.ts";
import * as support from "./snyk-test-support.ts";

describe("snyk token", { concurrency: false }, () => {
  const context = support.setupSnykClientTest();

  test("reports missing token clearly", async () => {
    await assert.rejects(
      () => listOpenIssues(),
      (error) => {
        assert.ok(
          (error as Error).message.includes("Snyk token not configured"),
        );
        return true;
      },
    );
  });

  test("hasToken uses stored credentials when present", () => {
    save("Triage Companion-Snyk", "token", "stored-token");
    assert.equal(hasToken(), true);
  });

  test("hasToken uses env token when store is empty", () => {
    process.env.SNYK_TOKEN = "env-token";
    assert.equal(hasToken(), true);
  });

  test("hasToken returns false when the persisted store is unreadable and no env token is set", () => {
    const secretsPath = path.join(context.testDir, "secrets.json");
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, "not json", "utf-8");
    resetCache();

    assert.equal(hasToken(), false);
  });

  test("hasToken returns false when the persisted store is unreadable even if env token is set", () => {
    const secretsPath = path.join(context.testDir, "secrets.json");
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, "not json", "utf-8");
    resetCache();
    process.env.SNYK_TOKEN = "env-token";

    assert.equal(hasToken(), false);
  });

  test("rejects empty token values", () => {
    assert.throws(() => saveToken("   "), /Snyk token is required/);
    assert.equal(hasToken(), false);
  });

  test("rejects saved Snyk tokens with surrounding whitespace", () => {
    assert.throws(() => saveToken(" snyk-token "), /Snyk token must not include surrounding whitespace/);
    assert.equal(hasToken(), false);
  });

  test("rejects Snyk tokens with control characters before API requests", async () => {
    process.env.SNYK_TOKEN = "token-\n123";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk token must not include control characters/,
    );
    assert.equal(hasToken(), false);
  });

  test("rejects Snyk tokens with surrounding whitespace before API requests", async () => {
    process.env.SNYK_TOKEN = " token-123 ";

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk token must not include surrounding whitespace/,
    );
    assert.equal(hasToken(), false);
  });

  test("rejects stored Snyk tokens with surrounding whitespace before API requests", async () => {
    save("Triage Companion-Snyk", "token", " stored-token ");

    await assert.rejects(
      () => listOpenIssues(),
      /Snyk token must not include surrounding whitespace/,
    );
    assert.equal(hasToken(), false);
  });
});

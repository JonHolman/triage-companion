import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listOpenIssues } from "./snyk.ts";
import { withMockFetch } from "./fetch-mock-test-support.ts";
import * as support from "./snyk-test-support.ts";

const orgsURL = "https://api.snyk.io/rest/orgs?version=2024-10-15&limit=100";

describe("snyk api errors", { concurrency: false }, () => {
  support.setupSnykClientTest();

  test("escapes control characters in raw Snyk API error payloads", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      () => new Response("bad\trequest\nretry", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          (error) => {
            const message = (error as Error).message;
            assert.match(message, /Snyk API error \(500\): bad\\trequest, retry/);
            assert.equal(message.includes("\t"), false);
            assert.equal(message.includes("\n"), false);
            return true;
          },
        );
      },
    );
  });

  test("rejects blank structured Snyk API error messages", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      () => support.createResponse({ errors: [{ detail: "   " }] }, 500),
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk API error \(500\): Snyk API error response error detail must be a non-empty string/,
        );
      },
    );
  });

  test("rejects non-object Snyk API error payloads", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      () => support.createResponse(["bad request"], 500),
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk API error \(500\): Snyk API error response must be a JSON object/,
        );
      },
    );
  });

  test("escapes control characters in Snyk fetch failures", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      () => {
        throw new Error("bad\trequest\nretry");
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          (error) => {
            const message = (error as Error).message;
            assert.match(message, /Could not load Snyk API response: bad\\trequest, retry/);
            assert.equal(message.includes("\t"), false);
            assert.equal(message.includes("\n"), false);
            return true;
          },
        );
      },
    );
  });

  test("rejects Snyk API responses missing data arrays", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      (input) => {
        assert.equal(input.toString(), orgsURL);
        return support.createResponse({ links: {} });
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk API response must include a data array/,
        );
      },
    );
  });

  test("rejects Snyk API responses that are not objects", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      (input) => {
        assert.equal(input.toString(), orgsURL);
        return support.createResponse(null);
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk API response must include a data array/,
        );
      },
    );
  });

  test("rejects invalid JSON Snyk API responses clearly", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      (input) => {
        assert.equal(input.toString(), orgsURL);
        return new Response("{", {
          status: 200,
          headers: { "Content-Type": "application/vnd.api+json" },
        });
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk API response must be valid JSON/,
        );
      },
    );
  });

  test("rejects Snyk API response entries with invalid top-level fields", async () => {
    process.env.SNYK_TOKEN = "token-123";

    await withMockFetch(
      (input) => {
        assert.equal(input.toString(), orgsURL);
        return support.createResponse({ data: [{ id: 123 }] });
      },
      async () => {
        await assert.rejects(
          () => listOpenIssues(),
          /Snyk API response data entries must be objects with valid top-level fields/,
        );
      },
    );
  });
});

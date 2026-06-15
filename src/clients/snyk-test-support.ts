import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";

import { resetCache } from "../credential-store.ts";

export interface SnykTestContext {
  readonly testDir: string;
}

export function setupSnykClientTest(): SnykTestContext {
  let originalConfigDir: string | undefined;
  let originalToken: string | undefined;
  let originalAPIBaseURL: string | undefined;
  let originalOrganizationIDs: string | undefined;
  let testDir = "";

  beforeEach(() => {
    originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    originalToken = process.env.SNYK_TOKEN;
    originalAPIBaseURL = process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    originalOrganizationIDs = process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS;

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-snyk-client-"));
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.SNYK_TOKEN;
    delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    delete process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS;

    resetCache();
  });

  afterEach(() => {
    resetCache();

    if (originalConfigDir === undefined) {
      delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
    } else {
      process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
    }

    if (originalToken === undefined) {
      delete process.env.SNYK_TOKEN;
    } else {
      process.env.SNYK_TOKEN = originalToken;
    }

    if (originalAPIBaseURL === undefined) {
      delete process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL;
    } else {
      process.env.TRIAGE_COMPANION_SNYK_API_BASE_URL = originalAPIBaseURL;
    }

    if (originalOrganizationIDs === undefined) {
      delete process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS;
    } else {
      process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS = originalOrganizationIDs;
    }

    fs.rmSync(testDir, { force: true, recursive: true });
  });

  return {
    get testDir() {
      return testDir;
    },
  };
}

export function createResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

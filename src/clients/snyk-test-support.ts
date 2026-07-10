import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";

import { resetCache } from "../credential-store.ts";
import { routeHandler, withMockFetch } from "./fetch-mock-test-support.ts";

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

export const acmeOrg = { id: "org-1", attributes: { slug: "acme", name: "Acme" } };
export const webAppProject = { id: "project-1", attributes: { name: "web-app" } };

export interface SnykIssueOverrides {
  readonly id?: unknown;
  readonly projectID?: unknown;
  readonly relationships?: unknown;
  readonly attributes?: Record<string, unknown>;
}

export function snykIssue(overrides: SnykIssueOverrides = {}): Record<string, unknown> {
  const id = Object.hasOwn(overrides, "id") ? overrides.id : "issue-1";
  const projectID = Object.hasOwn(overrides, "projectID") ? overrides.projectID : "project-1";
  const relationships = Object.hasOwn(overrides, "relationships")
    ? overrides.relationships
    : { scan_item: { data: { id: projectID, type: "project" } } };

  return {
    id,
    attributes: {
      key: typeof id === "string" ? id : "issue-key",
      title: "Example issue",
      type: "package_vulnerability",
      effective_severity_level: "high",
      status: "open",
      ignored: false,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
      ...overrides.attributes,
    },
    relationships,
  };
}

export interface SnykRoutesConfig {
  readonly orgs?: readonly unknown[];
  readonly projectsByOrg?: Readonly<Record<string, readonly unknown[]>>;
  readonly issuesByOrg?: Readonly<Record<string, readonly unknown[]>>;
  readonly baseURL?: string;
}

export function snykRoutes({
  orgs = [acmeOrg],
  projectsByOrg = {},
  issuesByOrg = {},
  baseURL = "https://api.snyk.io/rest",
}: SnykRoutesConfig): Map<string, () => Response> {
  const query = "version=2024-10-15&limit=100";
  const routes = new Map<string, () => Response>([
    [`${baseURL}/orgs?${query}`, () => createResponse({ data: orgs })],
  ]);
  for (const [orgID, projects] of Object.entries(projectsByOrg)) {
    routes.set(`${baseURL}/orgs/${orgID}/projects?${query}`, () => createResponse({ data: projects }));
  }
  for (const [orgID, issues] of Object.entries(issuesByOrg)) {
    routes.set(
      `${baseURL}/orgs/${orgID}/issues?status=open&ignored=false&${query}`,
      () => createResponse({ data: issues }),
    );
  }

  return routes;
}

export async function withSnykRoutes(
  config: SnykRoutesConfig,
  run: () => Promise<void> | void,
): Promise<void> {
  await withMockFetch(routeHandler(snykRoutes(config)), run);
}

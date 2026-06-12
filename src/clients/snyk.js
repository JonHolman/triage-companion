/**
 * Snyk REST API client — list open issues across organizations and projects.
 *
 * Token resolution order:
 *   1. Credential store  (Triage Companion-Snyk / token)
 *   2. Environment variable  SNYK_TOKEN
 *
 * Organization filter:
 *   TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS  (comma-separated)
 */

import * as creds from "../credential-store.js";

const SERVICE = "Triage Companion-Snyk";
const ACCOUNT = "token";
const API_VERSION = "2024-10-15";
const BASE_URL = "https://api.snyk.io/rest";
const PAGE_LIMIT = 100;
const USER_AGENT = "triage-companion";

// ── token helpers ──────────────────────────────────────────────────

function storedToken() {
  const t = creds.read(SERVICE, ACCOUNT)?.trim();
  return t || null;
}

function envToken() {
  const t = process.env.SNYK_TOKEN?.trim();
  return t || null;
}

function resolveToken() {
  return storedToken() ?? envToken();
}

export function hasToken() {
  return resolveToken() !== null;
}

export function saveToken(token) {
  creds.save(SERVICE, ACCOUNT, token.trim());
}

// ── internal helpers ───────────────────────────────────────────────

async function snykGet(url, token) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Token ${token}`,
      Accept: "application/vnd.api+json",
      "User-Agent": USER_AGENT,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      body?.errors?.[0]?.detail ||
      body?.errors?.[0]?.message ||
      body?.message ||
      `HTTP ${res.status}`;
    throw new Error(`Snyk API error (${res.status}): ${msg}`);
  }
  return res.json();
}

function str(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

async function paginate(path, queryParams, token) {
  const params = new URLSearchParams({
    ...queryParams,
    version: API_VERSION,
    limit: String(PAGE_LIMIT),
  });
  let url = `${BASE_URL}/${path.replace(/^\//, "")}?${params}`;
  const seen = new Set();
  const results = [];

  while (url) {
    const payload = await snykGet(url, token);
    if (Array.isArray(payload.data)) {
      results.push(...payload.data);
    }
    // next link
    const nextHref =
      typeof payload.links?.next === "string"
        ? payload.links.next
        : payload.links?.next?.href;
    if (!nextHref) break;
    const nextUrl = new URL(nextHref, BASE_URL).href;
    if (seen.has(nextUrl)) break;
    seen.add(nextUrl);
    url = nextUrl;
  }
  return results;
}

function configuredOrgIDs() {
  const raw = process.env.TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── public API ─────────────────────────────────────────────────────

/**
 * List all open Snyk issues across accessible organizations.
 *
 * Returns { issues, organizationCount, projectCount, checkedAt }.
 */
export async function listOpenIssues({ severity } = {}) {
  const token = resolveToken();
  if (!token) throw new Error("Snyk token not configured. Run: triage-companion snyk token <token>");

  // 1. List organizations
  const orgData = await paginate("/orgs", {}, token);
  let organizations = orgData.map((o) => ({
    id: o.id,
    slug: str(o.attributes, ["slug"]) ?? o.id,
    name: str(o.attributes, ["name"]) ?? o.id,
  }));

  // 2. Filter by configured IDs if set
  const filterIDs = configuredOrgIDs();
  if (filterIDs.length > 0) {
    const set = new Set(filterIDs);
    organizations = organizations.filter((o) => set.has(o.id));
    if (organizations.length === 0) {
      throw new Error(`No accessible orgs match TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS: ${filterIDs.join(", ")}`);
    }
  }

  const issues = [];
  const projectKeys = new Set();

  for (const org of organizations) {
    // 3. Fetch project names for this org
    const projectData = await paginate(`/orgs/${org.id}/projects`, {}, token);
    const projectNames = {};
    for (const p of projectData) {
      const name =
        str(p.attributes, ["name", "target_reference", "origin"]) ?? p.id;
      projectNames[p.id] = name;
    }

    // 4. Fetch issues
    const issueData = await paginate(`/orgs/${org.id}/issues`, {
      status: "open",
      ignored: "false",
    }, token);

    for (const item of issueData) {
      const attr = item.attributes ?? {};
      const rel = item.relationships ?? {};
      const scanItem = rel?.scan_item?.data;

      if (scanItem?.type && scanItem.type !== "project") continue;

      const projectID = scanItem?.id ?? null;
      const projectName =
        (projectID ? projectNames[projectID] : null) ??
        str(attr, ["project_name"]) ??
        "Unknown project";

      const rawID = item.id;
      if (!rawID) continue;

      const issueSeverity = str(attr, ["effective_severity_level", "severity"]) ?? "unknown";

      // Filter by severity if requested
      if (severity && issueSeverity.toLowerCase() !== severity.toLowerCase()) continue;

      issues.push({
        id: `${org.id}#${rawID}`,
        title: str(attr, ["title", "display_name", "name"]) ?? rawID,
        severity: issueSeverity,
        status: str(attr, ["status", "state"]) ?? "open",
        issueType: str(attr, ["type", "issue_type"]) ?? "issue",
        organizationID: org.id,
        organizationSlug: org.slug,
        organizationName: org.name,
        projectID,
        projectName,
        issueKey: str(attr, ["key"]) ?? null,
        packageName: str(attr, ["package_name", "coordinates", "display_target"]) ?? null,
        projectURL: projectID ? projectURL(org.slug, projectID, str(attr, ["key"])) : null,
        introducedAt: parseDate(str(attr, ["introduced_date", "created_at", "created"])),
        updatedAt: parseDate(str(attr, ["updated_at", "updated"])),
      });

      if (projectID) projectKeys.add(`${org.id}#${projectName}`);
    }
  }

  const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
  issues.sort(
    (a, b) =>
      (RANK[b.severity?.toLowerCase()] ?? 0) - (RANK[a.severity?.toLowerCase()] ?? 0) ||
      a.organizationName.localeCompare(b.organizationName) ||
      a.projectName.localeCompare(b.projectName) ||
      ((b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0)) ||
      a.title.localeCompare(b.title)
  );

  return {
    issues,
    organizationCount: organizations.length,
    projectCount: projectKeys.size,
    checkedAt: new Date(),
  };
}

function projectURL(orgSlug, projectID, issueKey) {
  const base = `https://app.snyk.io/org/${orgSlug}/project/${projectID}`;
  return issueKey ? `${base}#issue-${issueKey}` : base;
}

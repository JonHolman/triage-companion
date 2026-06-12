/**
 * Jira Cloud REST API client — list open tickets assigned to the current user.
 *
 * Credential resolution order:
 *   1. Credential store  (Triage Companion-Jira / base-url, email, api-token)
 *   2. Environment variables  JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
 */

import * as creds from "../credential-store.js";

const SERVICE = "Triage Companion-Jira";
const ACCOUNT_BASE_URL = "base-url";
const ACCOUNT_EMAIL = "email";
const ACCOUNT_TOKEN = "api-token";
const MAX_PAGE_SIZE = 100;
const ISSUE_FIELDS = "summary,status,priority,issuetype,reporter,updated";
const JQL = "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
const USER_AGENT = "triage-companion";

// ── credential helpers ─────────────────────────────────────────────

function storedBaseURL() {
  return creds.read(SERVICE, ACCOUNT_BASE_URL)?.trim() || null;
}
function storedEmail() {
  return creds.read(SERVICE, ACCOUNT_EMAIL)?.trim() || null;
}
function storedToken() {
  return creds.read(SERVICE, ACCOUNT_TOKEN)?.trim() || null;
}

function envBaseURL() {
  return process.env.JIRA_BASE_URL?.trim() || null;
}
function envEmail() {
  return process.env.JIRA_EMAIL?.trim() || null;
}
function envToken() {
  return process.env.JIRA_API_TOKEN?.trim() || null;
}

function resolveSettings() {
  const base = normalizeBaseURL(storedBaseURL() ?? envBaseURL());
  const email = storedEmail() ?? envEmail();
  const apiToken = storedToken() ?? envToken();
  if (!base || !email || !apiToken) return null;
  return { baseURL: base, email, apiToken };
}

export function hasCredentials() {
  return resolveSettings() !== null;
}

export function saveCredentials(baseURL, email, apiToken) {
  const normalized = normalizeBaseURL(baseURL);
  if (!normalized) throw new Error("Jira base URL is required.");
  creds.save(SERVICE, ACCOUNT_BASE_URL, normalized);
  creds.save(SERVICE, ACCOUNT_EMAIL, email.trim());
  creds.save(SERVICE, ACCOUNT_TOKEN, apiToken.trim());
}

// ── internal ───────────────────────────────────────────────────────

function authHeader(email, token) {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeBaseURL(baseURL) {
  const value = baseURL?.trim();
  if (!value) return null;
  const withScheme = value.startsWith("http") ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

// ── public API ─────────────────────────────────────────────────────

/**
 * List open Jira tickets assigned to the current user.
 * Returns Array of ticket objects.
 */
export async function listOpenTickets() {
  const settings = resolveSettings();
  if (!settings) {
    throw new Error(
      "Jira not configured. Run: triage-companion jira credentials <base-url> <email> <token>\n" +
      "Or set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN environment variables."
    );
  }

  const issues = [];
  let startAt = 0;

  while (true) {
    const params = new URLSearchParams({
      jql: JQL,
      fields: ISSUE_FIELDS,
      startAt: String(startAt),
      maxResults: String(MAX_PAGE_SIZE),
    });
    const url = `${settings.baseURL}/rest/api/3/search?${params}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader(settings.email, settings.apiToken),
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg =
        body?.errorMessage ||
        body?.errorMessages?.[0] ||
        `HTTP ${res.status}`;
      throw new Error(`Jira API error (${res.status}): ${msg}`);
    }

    const data = await res.json();
    for (const issue of data.issues ?? []) {
      const fields = issue.fields ?? {};
      const updatedDate = parseDate(fields.updated);
      issues.push({
        key: issue.key,
        issueType: fields.issuetype?.name ?? "Unknown",
        status: fields.status?.name ?? "Unknown",
        priority: fields.priority?.name ?? "Unknown",
        reporter: fields.reporter?.displayName ?? fields.reporter?.emailAddress ?? null,
        updatedText: updatedDate ? updatedDate.toLocaleString() : fields.updated ?? "Unknown",
        summary: fields.summary ?? "No summary",
        url: `${settings.baseURL}/browse/${issue.key}`,
      });
    }

    const next = data.startAt + data.maxResults;
    if (next >= data.total || (data.issues ?? []).length === 0) break;
    startAt = next;
  }

  return issues;
}

import * as creds from "../credential-store.ts";
import { ENV } from "../config.ts";
import {
  DEFAULT_SNYK_API_BASE_URL,
  getServiceDefinition,
  getServiceSetting,
  hasUnsafeURLPathSegments,
  normalizeSnykAPIBaseURL,
  US_SNYK_API_BASE_URLS,
} from "../config-model.ts";
import { KNOWN_SEVERITIES, normalizedKnownSeverity, severityRank } from "../severity.ts";

const tokenField = getServiceSetting("snyk", "token");
const apiBaseURLField = getServiceSetting("snyk", "apiBaseURL");
const SERVICE = tokenField.storage?.service ?? "Triage Companion-Snyk";
const ACCOUNT = tokenField.storage?.account ?? "token";
const API_BASE_URL_SERVICE = apiBaseURLField.storage?.service ?? "Triage Companion-Config";
const API_BASE_URL_ACCOUNT = apiBaseURLField.storage?.account ?? "snyk-api-base-url";
const API_VERSION = "2024-10-15";
const PAGE_LIMIT = 100;
const USER_AGENT = "triage-companion";
const US_SNYK_APP_HOSTS = new Set(["app.snyk.io", "app.us.snyk.io"]);
const snykPermissionText = getServiceDefinition("snyk").status.permissionRequirements
  .map((requirement) => `${requirement.feature}: ${requirement.permissions.join(", ")}`)
  .join("; ");

interface SnykRecord {
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

interface SnykOrganization {
  id: string;
  slug: string;
  name: string;
}

interface SnykIssue {
  id: string;
  url: string;
  title: string;
  severity: string;
  status: string;
  issueType: string;
  organizationID: string;
  organizationSlug: string;
  organizationName: string;
  projectID: string | null;
  projectName: string;
  issueKey: string | null;
  packageName: string | null;
  introducedAt: Date | null;
  updatedAt: Date | null;
}

interface SnykIssueSnapshot {
  issues: SnykIssue[];
  organizationCount: number;
  projectCount: number;
  checkedAt: Date;
}

interface ListOpenIssuesOptions {
  severity?: string;
}

function validateSeverityFilter(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.length === 0) {
    throw new Error("Snyk severity filter must not be empty.");
  }
  if (value.trim() !== value) {
    throw new Error("Snyk severity filter must not include surrounding whitespace.");
  }

  const normalized = normalizedKnownSeverity(value.toLowerCase());
  if (!normalized) {
    throw new Error(`Snyk severity filter must be one of: ${KNOWN_SEVERITIES.join(", ")}.`);
  }

  return normalized;
}

function resolveToken(): string | null {
  const token = creds.readCredential(SERVICE, ACCOUNT, tokenField.envVar ?? ENV.SNYK_TOKEN);
  return token !== null ? validateConfiguredText(token, "Snyk token") : null;
}

function validateConfiguredText(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  if (value.trim() !== value) {
    throw new Error(`${label} must not include surrounding whitespace.`);
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error(`${label} must not include control characters.`);
  }

  return value;
}

function validateAPIBaseURL(value: string): string {
  if (value.trim() !== value) {
    throw new Error("Snyk API base URL must not include surrounding whitespace.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error("Snyk API base URL must not include control characters.");
  }
  if (hasUnsafeURLPathSegments(value)) {
    throw new Error("Snyk API base URL must not include dot path segments.");
  }
  const baseURL = normalizeSnykAPIBaseURL(value);
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error("Snyk API base URL must be a valid https:// URL.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Snyk API base URL must not include credentials.");
  }
  if (parsed.port) {
    throw new Error("Snyk API base URL must not include a port.");
  }

  if (baseURL === "https://api.snykgov.io/rest") {
    throw new Error("Snyk Gov requires OAuth and is not supported by this token-based client.");
  }

  if (!(US_SNYK_API_BASE_URLS as readonly string[]).includes(baseURL)) {
    throw new Error(
      `Snyk API base URL must be US-hosted. Set ${ENV.SNYK_API_BASE_URL} to one of: ${US_SNYK_API_BASE_URLS.join(", ")}`,
    );
  }

  return baseURL;
}

function rawNonBlankEnvValue(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return value.trim().length === 0 ? null : value;
}

function isUSRestAPIURL(parsed: URL): boolean {
  return US_SNYK_API_BASE_URLS.some((baseURL) => {
    const allowedURL = new URL(baseURL);
    return (
      parsed.origin === allowedURL.origin &&
      (parsed.pathname === allowedURL.pathname ||
        parsed.pathname.startsWith(`${allowedURL.pathname}/`))
    );
  });
}

function validateRequestURL(value: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password) {
    throw new Error("Snyk API URL must not include credentials.");
  }
  if (parsed.port) {
    throw new Error("Snyk API URL must not include a port.");
  }
  if (parsed.hash) {
    throw new Error("Snyk API URL must not include fragments.");
  }

  if (!isUSRestAPIURL(parsed)) {
    throw new Error(
      `Snyk API URL must stay on a US-hosted REST API base URL: ${US_SNYK_API_BASE_URLS.join(", ")}`,
    );
  }

  if (parsed.searchParams.get("version") !== API_VERSION) {
    throw new Error(`Snyk API URL must include REST API version ${API_VERSION}.`);
  }

  return parsed.href;
}

function stableSnykPaginationQuery(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.delete("page");
  params.delete("starting_after");
  params.delete("ending_before");
  params.sort();
  return params.toString();
}

function rawURLPathSegments(value: string): string[] | null {
  const schemeIndex = value.indexOf("//");
  const pathAndSuffix =
    schemeIndex === -1
      ? value.startsWith("?") || value.startsWith("#") || value.length === 0
        ? ""
        : value
      : (() => {
          const pathStart = value.indexOf("/", schemeIndex + 2);
          return pathStart === -1 ? "/" : value.slice(pathStart);
        })();
  const searchIndex = pathAndSuffix.indexOf("?");
  const hashIndex = pathAndSuffix.indexOf("#");
  const pathEndCandidates = [searchIndex, hashIndex].filter((index) => index >= 0);
  const pathEnd =
    pathEndCandidates.length > 0 ? Math.min(...pathEndCandidates) : pathAndSuffix.length;
  const rawPath = pathAndSuffix.slice(0, pathEnd);

  try {
    if (rawPath.length === 0) {
      return [];
    }

    const parts = rawPath.split("/");
    const hasLeadingSlash = parts[0] === "";
    const hasTrailingSlash = parts[parts.length - 1] === "";
    const segments = hasLeadingSlash
      ? hasTrailingSlash
        ? parts.slice(1, -1)
        : parts.slice(1)
      : hasTrailingSlash
        ? parts.slice(0, -1)
        : parts;
    if (segments.some((part) => part.length === 0)) {
      return null;
    }

    const decoded = segments.map((part) => decodeURIComponent(part));
    return decoded.some((part) => part === "." || part === "..") ? null : decoded;
  } catch {
    return null;
  }
}

function snykPaginationLoopKey(value: string): string {
  const parsed = new URL(value);
  parsed.searchParams.sort();
  return parsed.href;
}

function recordSnykPaginationURL(seen: Set<string>, next: string): void {
  const nextKey = snykPaginationLoopKey(next);
  if (seen.has(nextKey)) {
    throw new Error("Snyk pagination link repeated a previously fetched page.");
  }

  seen.add(nextKey);
}

function validatePaginationURL(value: string, currentValue: string): string {
  let parsed: URL;
  let current: URL;
  try {
    parsed = new URL(value);
    current = new URL(currentValue);
  } catch {
    throw new Error("Snyk pagination link must be a valid URL.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Snyk pagination link must not include credentials.");
  }
  if (parsed.port) {
    throw new Error("Snyk pagination link must not include a port.");
  }
  if (parsed.hash) {
    throw new Error("Snyk pagination link must not include fragments.");
  }

  if (!isUSRestAPIURL(parsed)) {
    throw new Error(
      `Snyk pagination link must stay on a US-hosted REST API base URL: ${US_SNYK_API_BASE_URLS.join(", ")}`,
    );
  }

  const path = rawURLPathSegments(value);
  const currentPath = rawURLPathSegments(currentValue);
  if (
    parsed.origin !== current.origin ||
    !path ||
    !currentPath ||
    path.length !== currentPath.length ||
    path.some((part, index) => part !== currentPath[index])
  ) {
    throw new Error("Snyk pagination link must stay on the current API route.");
  }

  const parsedVersion = parsed.searchParams.get("version");
  if (!parsedVersion) {
    throw new Error("Snyk pagination link must include a REST API version.");
  }

  if (parsedVersion !== current.searchParams.get("version")) {
    throw new Error("Snyk pagination link must keep the current REST API version.");
  }

  if (stableSnykPaginationQuery(parsed) !== stableSnykPaginationQuery(current)) {
    throw new Error("Snyk pagination link must keep the current API query.");
  }

  return parsed.href;
}

function resolveAPIBaseURL(): string {
  const envVar = apiBaseURLField.envVar ?? ENV.SNYK_API_BASE_URL;
  if (Object.hasOwn(process.env, envVar)) {
    return validateAPIBaseURL(process.env[envVar] ?? "");
  }

  const storedValue = creds.read(API_BASE_URL_SERVICE, API_BASE_URL_ACCOUNT);
  return validateAPIBaseURL(storedValue ?? DEFAULT_SNYK_API_BASE_URL);
}

export function apiBaseURLEnvOverrideState(
  raw: string | undefined | null = process.env[apiBaseURLField.envVar ?? ENV.SNYK_API_BASE_URL],
): "missing" | "valid" | "invalid" {
  if (raw === undefined || raw === null) {
    return "missing";
  }

  try {
    return validateAPIBaseURL(raw) ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

export function hasToken(): boolean {
  try {
    return resolveToken() !== null;
  } catch {
    return false;
  }
}

export function saveToken(token: string): void {
  const validated = validateConfiguredText(token, "Snyk token");
  creds.save(SERVICE, ACCOUNT, validated);
}

export function removeToken(): void {
  creds.remove(SERVICE, ACCOUNT);
}

export function saveAPIBaseURL(value: string): string {
  const normalized = validateAPIBaseURL(value);
  creds.save(API_BASE_URL_SERVICE, API_BASE_URL_ACCOUNT, normalized);
  return normalized;
}

export function removeAPIBaseURL(): void {
  creds.remove(API_BASE_URL_SERVICE, API_BASE_URL_ACCOUNT);
}

export function currentAPIBaseURL(): string {
  return resolveAPIBaseURL();
}

function inlineErrorText(text: string): string {
  const normalizedLineBreaks = text.replace(/\r\n?|\n/g, ", ");
  return normalizedLineBreaks.replace(/[\u0000-\u001F\u007F-\u009F]/g, (character) => {
    switch (character) {
      case "\t":
        return "\\t";
      default:
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    }
  });
}

async function snykErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return "Snyk API error response body was empty.";
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return inlineErrorText(text);
  }

  if (!isRecord(body)) {
    return "Snyk API error response must be a JSON object.";
  }

  const errors = body.errors;
  if (errors !== undefined) {
    if (!Array.isArray(errors)) {
      return "Snyk API error response errors must be an array.";
    }
    if (errors.length === 0) {
      return "Snyk API error response errors must include at least one error.";
    }
    if (!isRecord(errors[0])) {
      return "Snyk API error response error entries must be objects.";
    }

    const firstError = errors[0];
    const message = pickString(firstError, ["detail", "message"]);
    if (message) {
      return message;
    }
    const invalidMessage = invalidStringCandidate(firstError, ["detail", "message"]);
    if (invalidMessage) {
      return `Snyk API error response error ${invalidMessage.key} ${invalidMessage.reason}.`;
    }

    return "Snyk API error response error must include detail or message.";
  }

  const message = pickString(body, ["message"]);
  if (message) {
    return message;
  }
  const invalidMessage = invalidStringCandidate(body, ["message"]);
  if (invalidMessage) {
    return `Snyk API error response ${invalidMessage.key} ${invalidMessage.reason}.`;
  }

  return "Snyk API error response must include errors or message.";
}

async function parseSnykJSON(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new Error("Snyk API response must be valid JSON.");
  }
}

async function snykGet(url: string, token: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(validateRequestURL(url), {
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: `Token ${token}`,
        Accept: "application/vnd.api+json",
        "User-Agent": USER_AGENT,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    const message = inlineErrorText(error instanceof Error ? error.message : String(error));
    throw new Error(`Could not load Snyk API response: ${message}`, {
      cause: error,
    });
  }

  if (!response.ok) {
    const message = await snykErrorMessage(response);
    throw new Error(`Snyk API error (${response.status}): ${message}`);
  }

  return parseSnykJSON(response);
}

function pickString(value: unknown, keys: readonly string[]): string | null {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (
      typeof candidate === "string" &&
      candidate.trim().length > 0 &&
      candidate.trim() === candidate &&
      !/[\u0000-\u001F\u007F-\u009F]/.test(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

function invalidStringCandidate(
  value: unknown,
  keys: readonly string[],
): { key: string; reason: string } | null {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of keys) {
    if (!(key in value)) {
      continue;
    }

    const candidate = value[key];
    if (candidate === undefined) {
      continue;
    }
    if (typeof candidate !== "string") {
      return { key, reason: "must be a string" };
    }
    if (candidate.trim().length === 0) {
      return { key, reason: "must be a non-empty string" };
    }
    if (candidate.trim() !== candidate) {
      return { key, reason: "must not include surrounding whitespace" };
    }
    if (/[\u0000-\u001F\u007F-\u009F]/.test(candidate)) {
      return { key, reason: "must not include control characters" };
    }
  }

  return null;
}

function validatedStringCandidate(
  value: unknown,
  keys: readonly string[],
  context: string,
): string | null {
  const invalidCandidate = invalidStringCandidate(value, keys);
  if (invalidCandidate) {
    throw new Error(`${context} ${invalidCandidate.key} ${invalidCandidate.reason}.`);
  }

  return pickString(value, keys);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const hour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);
  const second = Number.parseInt(match[6] ?? "", 10);
  const offset = match[7] ?? "";
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDay ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  if (offset !== "Z") {
    const offsetMatch = /^[+-](\d{2}):?(\d{2})$/.exec(offset);
    const offsetHour = Number.parseInt(offsetMatch?.[1] ?? "", 10);
    const offsetMinute = Number.parseInt(offsetMatch?.[2] ?? "", 10);
    if (offsetHour > 23 || offsetMinute > 59) {
      return null;
    }
  }

  const normalizedValue = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(normalizedValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function isSnykRecord(value: unknown): value is SnykRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.id === undefined || typeof value.id === "string") &&
    (value.attributes === undefined || isRecord(value.attributes)) &&
    (value.relationships === undefined || isRecord(value.relationships))
  );
}

function scanItemRelationship(
  item: SnykRecord,
  context: string,
): { id: string | null; type: string | null } | null {
  const relationship = item.relationships?.scan_item;
  if (relationship === undefined) {
    return null;
  }
  if (!isRecord(relationship)) {
    throw new Error(`${context} scan_item relationship must be an object.`);
  }

  const data = relationship.data;
  if (data === undefined || data === null) {
    return null;
  }
  if (!isRecord(data)) {
    throw new Error(`${context} scan_item relationship data must be an object.`);
  }

  const id = data.id;
  if (id !== undefined && typeof id !== "string") {
    throw new Error(`${context} scan_item relationship id must be a string.`);
  }

  const type = data.type;
  if (type !== undefined && typeof type !== "string") {
    throw new Error(`${context} scan_item relationship type must be a string.`);
  }
  if (id === undefined && type === undefined) {
    throw new Error(`${context} scan_item relationship must include an id and type.`);
  }
  if (id !== undefined && type === undefined) {
    throw new Error(`${context} scan_item relationship must include a type.`);
  }

  return {
    id: id ?? null,
    type: type ?? null,
  };
}

function validateAPIPathID(value: string, context: string): string {
  const trimmed = value.trim();
  if (trimmed !== value) {
    throw new Error(`${context} must not include surrounding whitespace.`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new Error(`${context} must be a safe API path segment.`);
  }

  return trimmed;
}

function decodeRawURLPathSegments(value: string, issueId: string): string[] {
  const schemeIndex = value.indexOf("//");
  if (schemeIndex === -1) {
    throw new Error(`Snyk issue URL must have a valid path: ${issueId}`);
  }

  const pathStart = value.indexOf("/", schemeIndex + 2);
  const pathAndSuffix = pathStart === -1 ? "/" : value.slice(pathStart);
  const searchIndex = pathAndSuffix.indexOf("?");
  const hashIndex = pathAndSuffix.indexOf("#");
  const pathEndCandidates = [searchIndex, hashIndex].filter((index) => index >= 0);
  const pathEnd =
    pathEndCandidates.length > 0 ? Math.min(...pathEndCandidates) : pathAndSuffix.length;
  const rawPath = pathAndSuffix.slice(0, pathEnd);

  try {
    const parts = rawPath.split("/");
    if (parts[0] !== "") {
      throw new Error("invalid path");
    }

    const hasTrailingSlash = parts[parts.length - 1] === "";
    const segments = hasTrailingSlash ? parts.slice(1, -1) : parts.slice(1);
    if (segments.length === 0 || segments.some((part) => part.length === 0)) {
      throw new Error("invalid path");
    }

    return segments.map((part) => decodeURIComponent(part));
  } catch {
    throw new Error(`Snyk issue URL must have a valid path: ${issueId}`);
  }
}

function validateSnykIssueURL(
  value: string,
  issueId: string,
  organizationSlug: string,
  projectID: string | null,
): string {
  const safeOrganizationSlug = validateAPIPathID(organizationSlug, "Snyk organization slug");
  const safeProjectID = projectID
    ? validateAPIPathID(projectID, "Snyk project ID")
    : null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Snyk issue URL must be a valid US-hosted Snyk app URL: ${issueId}`);
  }

  if (url.protocol !== "https:" || !US_SNYK_APP_HOSTS.has(url.hostname)) {
    throw new Error(`Snyk issue URL must be US-hosted: ${issueId}`);
  }

  if (url.port) {
    throw new Error(`Snyk issue URL must not include a port: ${issueId}`);
  }

  if (url.username || url.password) {
    throw new Error(`Snyk issue URL must not include credentials: ${issueId}`);
  }
  if (url.search) {
    throw new Error(`Snyk issue URL must not include query strings: ${issueId}`);
  }

  if (url.hash !== `#issue-${encodeURIComponent(issueId)}`) {
    throw new Error(`Snyk issue URL must link to issue ${issueId}.`);
  }

  const parts = decodeRawURLPathSegments(value, issueId);

  if (parts.length < 2 || parts[0] !== "org") {
    throw new Error(`Snyk issue URL must link to organization ${safeOrganizationSlug}: ${issueId}`);
  }

  validateAPIPathID(parts[1] ?? "", "Snyk organization slug");
  if (parts[1] !== safeOrganizationSlug) {
    throw new Error(`Snyk issue URL must link to organization ${safeOrganizationSlug}: ${issueId}`);
  }

  if (safeProjectID) {
    const matchesProjectPage =
      parts.length === 4 &&
      parts[0] === "org" &&
      parts[1] === safeOrganizationSlug &&
      parts[2] === "project" &&
      parts[3] === safeProjectID;

    if (!matchesProjectPage) {
      throw new Error(`Snyk issue URL must link to project ${safeProjectID}: ${issueId}`);
    }
  }

  if (!safeProjectID) {
    const matchesOrgIssuesPage =
      parts.length === 3 &&
      parts[0] === "org" &&
      parts[1] === safeOrganizationSlug &&
      parts[2] === "issues";

    if (!matchesOrgIssuesPage) {
      throw new Error(`Snyk issue URL without a project relationship must link to organization issues page ${safeOrganizationSlug}: ${issueId}`);
    }
  }

  return url.href;
}

async function paginate(
  path: string,
  queryParams: Record<string, string>,
  token: string,
  baseURL: string,
): Promise<SnykRecord[]> {
  const params = new URLSearchParams({
    ...queryParams,
    version: API_VERSION,
    limit: String(PAGE_LIMIT),
  });
  let url = `${baseURL}/${path.replace(/^\//, "")}?${params}`;
  const seen = new Set<string>([snykPaginationLoopKey(url)]);
  const results: SnykRecord[] = [];

  while (true) {
    const payload = await snykGet(url, token);
    const data = isRecord(payload) ? payload.data : undefined;
    if (!isRecord(payload) || !Array.isArray(data)) {
      throw new Error("Snyk API response must include a data array.");
    }
    const records = data.filter(isSnykRecord);
    if (records.length !== data.length) {
      throw new Error("Snyk API response data entries must be objects with valid top-level fields.");
    }

    results.push(...records);

    if ("links" in payload && payload.links !== undefined && !isRecord(payload.links)) {
      throw new Error("Snyk API response links must be an object.");
    }
    const links = recordField(payload, "links");
    const nextHref = resolvePaginationHref(links?.next);

    if (!nextHref) {
      break;
    }
    if (!rawURLPathSegments(nextHref)) {
      throw new Error("Snyk pagination link must stay on the current API route.");
    }

    let resolvedNextHref: string;
    try {
      resolvedNextHref = new URL(nextHref, url).href;
    } catch {
      throw new Error("Snyk pagination link must be a valid URL.");
    }

    const nextUrl = validatePaginationURL(resolvedNextHref, url);
    if (data.length === 0) {
      throw new Error("Snyk API response returned an empty page before pagination finished.");
    }
    recordSnykPaginationURL(seen, nextUrl);
    url = nextUrl;
  }

  return results;
}

function resolvePaginationHref(next: unknown): string | undefined {
  if (next === undefined || next === null) {
    return undefined;
  }

  if (typeof next === "string") {
    if (
      next.trim().length === 0 ||
      next.trim() !== next ||
      /[\u0000-\u001F\u007F-\u009F]/.test(next)
    ) {
      throw new Error("Snyk pagination link must be a valid URL.");
    }
    return next;
  }

  if (!isRecord(next)) {
    throw new Error("Snyk pagination link must be a valid URL.");
  }

  const href = next.href;
  if (
    typeof href !== "string" ||
    href.trim().length === 0 ||
    href.trim() !== href ||
    /[\u0000-\u001F\u007F-\u009F]/.test(href)
  ) {
    throw new Error("Snyk pagination link must be a valid URL.");
  }

  return href;
}

function configuredOrgIDs(): string[] {
  const raw = rawNonBlankEnvValue(process.env[ENV.SNYK_ORGANIZATION_IDS]);
  if (!raw) {
    return [];
  }

  const entries = raw.split(",");
  const trimmedEntries = entries.map((entry) => entry.trim());

  if (trimmedEntries.every((entry) => entry.length === 0)) {
    throw new Error(`${ENV.SNYK_ORGANIZATION_IDS} must include at least one organization ID.`);
  }

  if (trimmedEntries.some((entry) => entry.length === 0)) {
    throw new Error(`${ENV.SNYK_ORGANIZATION_IDS} must contain safe IDs separated by commas.`);
  }

  return entries.map((entry) => validateAPIPathID(entry, ENV.SNYK_ORGANIZATION_IDS));
}

export async function listOpenIssues({
  severity,
}: ListOpenIssuesOptions = {}): Promise<SnykIssueSnapshot> {
  const validatedSeverity = validateSeverityFilter(severity);
  const filterIDs = configuredOrgIDs();
  const baseURL = resolveAPIBaseURL();
  const token = resolveToken();
  if (!token) {
    throw new Error(
      `Snyk token not configured. Save one with ` +
        "`triage-companion snyk token <token>` or set SNYK_TOKEN. " +
        `Required permissions: ${snykPermissionText}`,
    );
  }

  const orgData = await paginate("/orgs", {}, token, baseURL);
  let organizations: SnykOrganization[] = [];
  const seenOrganizationIDs = new Set<string>();
  for (const org of orgData) {
    if (org.id === undefined) {
      throw new Error("Snyk API response included an organization without an id.");
    }

    const organizationID = validateAPIPathID(org.id, "Snyk organization ID");
    if (seenOrganizationIDs.has(organizationID)) {
      continue;
    }

    seenOrganizationIDs.add(organizationID);
    const organizationAttributes = org.attributes;
    if (!organizationAttributes) {
      throw new Error(`Snyk organization ${organizationID} attributes must be an object.`);
    }
      const organizationSlug = pickString(organizationAttributes, ["slug"]);
      if (!organizationSlug) {
        const invalidOrganizationSlug = invalidStringCandidate(organizationAttributes, ["slug"]);
        if (invalidOrganizationSlug) {
          throw new Error(
            `Snyk organization ${organizationID} ${invalidOrganizationSlug.key} ${invalidOrganizationSlug.reason}.`,
          );
        }
        throw new Error(`Snyk organization missing slug: ${organizationID}`);
      }
      const organizationName = pickString(organizationAttributes, ["name"]);
      if (!organizationName) {
        const invalidOrganizationName = invalidStringCandidate(organizationAttributes, ["name"]);
        if (invalidOrganizationName) {
          throw new Error(
            `Snyk organization ${organizationID} ${invalidOrganizationName.key} ${invalidOrganizationName.reason}.`,
          );
        }
        throw new Error(`Snyk organization missing name: ${organizationID}`);
      }

    organizations.push({
      id: organizationID,
      slug: validateAPIPathID(organizationSlug, "Snyk organization slug"),
      name: organizationName,
    });
  }

  if (filterIDs.length > 0) {
    const allowed = new Set(filterIDs);
    organizations = organizations.filter((org) => allowed.has(org.id));

    if (organizations.length === 0) {
      throw new Error(
        `No accessible orgs match TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS: ${filterIDs.join(", ")}`,
      );
    }
  }

  const issues: SnykIssue[] = [];
  const projectKeys = new Set<string>();

  for (const org of organizations) {
    const orgID = validateAPIPathID(org.id, "Snyk organization ID");
    const encodedOrgID = encodeURIComponent(orgID);
    const projectData = await paginate(`/orgs/${encodedOrgID}/projects`, {}, token, baseURL);
    const projectNames = new Map<string, string>();
    for (const project of projectData) {
      if (project.id === undefined) {
        throw new Error("Snyk API response included a project without an id.");
      }

      const projectID = validateAPIPathID(project.id, "Snyk project ID");
      const projectAttributes = project.attributes;
      if (!projectAttributes) {
        throw new Error(`Snyk project ${projectID} attributes must be an object.`);
      }
      const name = validatedStringCandidate(
        projectAttributes,
        ["name", "target_reference", "origin"],
        `Snyk project ${projectID}`,
      );
      if (!name) {
        throw new Error(`Snyk project missing name: ${projectID}`);
      }

      projectNames.set(projectID, name);
    }

    const issueData = await paginate(
      `/orgs/${encodedOrgID}/issues`,
      {
        status: "open",
        ignored: "false",
      },
      token,
      baseURL,
    );

    for (const item of issueData) {
      const rawIssueId = item.id;
      if (rawIssueId === undefined) {
        throw new Error("Snyk API response included an issue without an id.");
      }
      const issueId = validateAPIPathID(rawIssueId, "Snyk issue ID");
      const attributes = item.attributes;
      if (!attributes) {
        throw new Error(`Snyk issue ${issueId} attributes must be an object.`);
      }
      const scanItem = scanItemRelationship(item, `Snyk issue ${issueId}`);

      if (scanItem?.type && scanItem.type !== "project") {
        throw new Error(`Snyk issue ${issueId} scan_item relationship type must be project.`);
      }
      if (scanItem?.type === "project" && scanItem.id === null) {
        throw new Error(`Snyk issue ${issueId} scan_item relationship must include a project id.`);
      }

      const projectID = scanItem && scanItem.id !== null
        ? validateAPIPathID(scanItem.id, "Snyk project ID")
        : null;

      const rawIssueURL = attributes.url;
      if (rawIssueURL === undefined) {
        throw new Error(`Snyk issue missing url: ${issueId}`);
      }
      if (typeof rawIssueURL !== "string") {
        throw new Error(`Snyk issue ${issueId} url must be a string.`);
      }
      const issueURL = pickString({ url: rawIssueURL }, ["url"]);
      if (!issueURL) {
        const invalidIssueURL = invalidStringCandidate({ url: rawIssueURL }, ["url"]);
        if (invalidIssueURL) {
          throw new Error(`Snyk issue ${issueId} ${invalidIssueURL.key} ${invalidIssueURL.reason}.`);
        }
        throw new Error(`Snyk issue missing url: ${issueId}`);
      }

      const issueSeverity = validatedStringCandidate(
        attributes,
        ["effective_severity_level", "severity"],
        `Snyk issue ${issueId}`,
      );
      if (!issueSeverity) {
        throw new Error(`Snyk issue missing severity: ${issueId}`);
      }
      if (!normalizedKnownSeverity(issueSeverity)) {
        throw new Error(`Snyk issue ${issueId} severity must be one of critical, high, medium, or low.`);
      }
      const issueStatus = validatedStringCandidate(
        attributes,
        ["status", "state"],
        `Snyk issue ${issueId}`,
      );
      if (!issueStatus) {
        throw new Error(`Snyk issue missing status: ${issueId}`);
      }
      if (issueStatus.toLowerCase() !== "open") {
        throw new Error(`Snyk issue ${issueId} must have status open.`);
      }
      if ("ignored" in attributes) {
        if (typeof attributes.ignored !== "boolean") {
          throw new Error(`Snyk issue ${issueId} ignored must be a boolean.`);
        }
        if (attributes.ignored) {
          throw new Error(`Snyk issue ${issueId} must not be ignored.`);
        }
      }
      if (validatedSeverity && issueSeverity.toLowerCase() !== validatedSeverity) {
        continue;
      }
      const issueType = validatedStringCandidate(
        attributes,
        ["type", "issue_type"],
        `Snyk issue ${issueId}`,
      );
      if (!issueType) {
        throw new Error(`Snyk issue missing type: ${issueId}`);
      }
      const issueTitle = validatedStringCandidate(
        attributes,
        ["title", "display_name", "name"],
        `Snyk issue ${issueId}`,
      );
      if (!issueTitle) {
        throw new Error(`Snyk issue missing title: ${issueId}`);
      }
      const validatedIssueURL = validateSnykIssueURL(issueURL, issueId, org.slug, projectID);
      let projectName: string;
      if (projectID) {
        const name = projectNames.get(projectID);
        if (!name) {
          throw new Error(`Snyk issue ${issueId} references unknown project ${projectID}.`);
        }
        projectName = name;
      } else {
        const name = validatedStringCandidate(attributes, ["project_name"], `Snyk issue ${issueId}`);
        if (!name) {
          throw new Error(`Snyk issue missing project name: ${issueId}`);
        }
        projectName = name;
      }

      const introducedAtText = validatedStringCandidate(
        attributes,
        ["introduced_date", "created_at", "created"],
        `Snyk issue ${issueId}`,
      );
      const updatedAtText = validatedStringCandidate(
        attributes,
        ["updated_at", "updated"],
        `Snyk issue ${issueId}`,
      );
      const introducedAt = parseDate(introducedAtText);
      if (introducedAtText && !introducedAt) {
        throw new Error(`Snyk issue invalid introduced timestamp: ${issueId}`);
      }
      const updatedAt = parseDate(updatedAtText);
      if (updatedAtText && !updatedAt) {
        throw new Error(`Snyk issue invalid updated timestamp: ${issueId}`);
      }

      issues.push({
        id: `${orgID}#${issueId}`,
        url: validatedIssueURL,
        title: issueTitle,
        severity: issueSeverity,
        status: issueStatus,
        issueType,
        organizationID: orgID,
        organizationSlug: org.slug,
        organizationName: org.name,
        projectID,
        projectName,
        issueKey: (() => {
          const issueKey = validatedStringCandidate(attributes, ["key"], `Snyk issue ${issueId}`);
          if (issueKey) {
            return issueKey;
          }

          return null;
        })(),
        packageName: (() => {
          const packageName = validatedStringCandidate(
            attributes,
            ["package_name", "coordinates", "display_target"],
            `Snyk issue ${issueId}`,
          );
          if (packageName) {
            return packageName;
          }

          return null;
        })(),
        introducedAt,
        updatedAt,
      });

      projectKeys.add(projectID ? `${orgID}#${projectID}` : `${orgID}#name:${projectName}`);
    }
  }

  issues.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.organizationName.localeCompare(b.organizationName) ||
      a.projectName.localeCompare(b.projectName) ||
      (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0) ||
      a.title.localeCompare(b.title),
  );

  return {
    issues,
    organizationCount: organizations.length,
    projectCount: projectKeys.size,
    checkedAt: new Date(),
  };
}

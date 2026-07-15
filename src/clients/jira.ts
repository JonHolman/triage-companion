import * as creds from "../credential-store.ts";
import {
  hasCanonicalTextValue as isTextValue,
  inlineErrorText,
  isRecord,
  parseDate,
  recordField,
  stringField,
  validateConfiguredText,
} from "../text.ts";
import {
  getServiceDefinition,
  getServiceSetting,
  hasUnsafeURLPathSegments,
  requiredSettingEnvVar,
  requiredSettingStorage,
} from "../config-model.ts";

const baseURLField = getServiceSetting("jira", "baseURL");
const emailField = getServiceSetting("jira", "email");
const apiTokenField = getServiceSetting("jira", "apiToken");
const cloudIDField = getServiceSetting("jira", "cloudId");

const baseURLStorage = requiredSettingStorage(baseURLField);
const emailStorage = requiredSettingStorage(emailField);
const apiTokenStorage = requiredSettingStorage(apiTokenField);
const cloudIDStorage = requiredSettingStorage(cloudIDField);
const SERVICE = baseURLStorage.service;
const ACCOUNT_BASE_URL = baseURLStorage.account;
const ACCOUNT_EMAIL = emailStorage.account;
const ACCOUNT_TOKEN = apiTokenStorage.account;
const ACCOUNT_CLOUD_ID = cloudIDStorage.account;
const MAX_PAGE_SIZE = 100;
const ISSUE_FIELDS = "summary,status,priority,issuetype,reporter,updated,resolution";
const JQL = "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
const USER_AGENT = "triage-companion";
const jiraPermissionText = getServiceDefinition("jira").status.permissionRequirements
  .map((requirement) => `${requirement.feature}: ${requirement.permissions.join(", ")}`)
  .join("; ");

type JiraAPIKind = "cloud" | "data-center";

interface JiraSettings {
  baseURL: string;
  email: string;
  apiToken: string;
  cloudID: string | null;
}

interface JiraTicket {
  key: string;
  issueType: string;
  status: string;
  priority: string | null;
  reporter: string | null;
  updatedAt: Date;
  updatedText: string;
  summary: string;
  url: string;
}

function readSettingWithEnvironmentOverride(account: string, envVar: string): string | null {
  if (Object.hasOwn(process.env, envVar)) {
    return process.env[envVar] ?? "";
  }

  return creds.read(SERVICE, account);
}

function resolveSettings(): JiraSettings | null {
  const base = normalizeBaseURL(
    readSettingWithEnvironmentOverride(ACCOUNT_BASE_URL, requiredSettingEnvVar(baseURLField)),
  );
  const rawEmail = readSettingWithEnvironmentOverride(ACCOUNT_EMAIL, requiredSettingEnvVar(emailField));
  const rawApiToken = readSettingWithEnvironmentOverride(
    ACCOUNT_TOKEN,
    requiredSettingEnvVar(apiTokenField),
  );
  const rawCloudID = readSettingWithEnvironmentOverride(
    ACCOUNT_CLOUD_ID,
    requiredSettingEnvVar(cloudIDField),
  );

  if (!base || rawEmail === null || rawApiToken === null) {
    return null;
  }

  const email = validateConfiguredText(rawEmail, "Jira email");
  const apiToken = validateConfiguredText(rawApiToken, "Jira API token");
  const cloudID = rawCloudID === null ? null : validateCloudID(rawCloudID);

  return { baseURL: base, email, apiToken, cloudID };
}

export function hasCredentials(): boolean {
  try {
    return resolveSettings() !== null;
  } catch {
    return false;
  }
}

export function saveCredentials(baseURL: string, email: string, apiToken: string, cloudID?: string): void {
  const normalized = normalizeBaseURL(baseURL);
  if (!normalized) {
    throw new Error("Jira base URL is required.");
  }

  const validatedEmail = validateConfiguredText(email, "Jira email");
  const validatedToken = validateConfiguredText(apiToken, "Jira API token");
  const validatedCloudID = cloudID === undefined || cloudID === "" ? null : validateCloudID(cloudID);

  creds.updateMany([
    { service: SERVICE, account: ACCOUNT_BASE_URL, value: normalized },
    { service: SERVICE, account: ACCOUNT_EMAIL, value: validatedEmail },
    { service: SERVICE, account: ACCOUNT_TOKEN, value: validatedToken },
    { service: SERVICE, account: ACCOUNT_CLOUD_ID, value: validatedCloudID },
  ]);
}

export function removeCredentials(): void {
  creds.updateMany([
    { service: SERVICE, account: ACCOUNT_BASE_URL, value: null },
    { service: SERVICE, account: ACCOUNT_EMAIL, value: null },
    { service: SERVICE, account: ACCOUNT_TOKEN, value: null },
    { service: SERVICE, account: ACCOUNT_CLOUD_ID, value: null },
  ]);
}

function authHeader(settings: JiraSettings): string {
  return jiraAPIKind(settings) === "data-center"
    ? `Bearer ${settings.apiToken}`
    : `Basic ${Buffer.from(`${settings.email}:${settings.apiToken}`).toString("base64")}`;
}

function validateCloudID(value: string): string {
  const validation = cloudIDField.validate?.(value) ?? null;
  if (validation !== null) {
    throw new Error(`Jira Cloud ID ${validation}.`);
  }

  return value;
}

function jiraAPIBaseURL(settings: JiraSettings): string {
  return settings.cloudID === null
    ? settings.baseURL
    : `https://api.atlassian.com/ex/jira/${settings.cloudID}`;
}

function jiraAPIKind(settings: JiraSettings): JiraAPIKind {
  if (settings.cloudID !== null) {
    return "cloud";
  }

  const hostname = new URL(settings.baseURL).hostname.toLowerCase();
  return hostname.endsWith(".atlassian.net") ? "cloud" : "data-center";
}

function jiraSearchPath(settings: JiraSettings): string {
  return jiraAPIKind(settings) === "data-center"
    ? "/rest/api/2/search"
    : "/rest/api/3/search/jql";
}

function isNamedFieldRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isTextValue(value.name);
}

function isReporterFieldRecord(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (isTextValue(value.displayName) || isTextValue(value.emailAddress)) &&
    (value.displayName === undefined || isTextValue(value.displayName)) &&
    (value.emailAddress === undefined || isTextValue(value.emailAddress))
  );
}

function isIssueFieldsResponse(value: Record<string, unknown>): boolean {
  return (
    isTextValue(value.summary) &&
    isTextValue(value.updated) &&
    isNamedFieldRecord(value.issuetype) &&
    isNamedFieldRecord(value.status) &&
    (value.priority === null || isNamedFieldRecord(value.priority)) &&
    (value.resolution === undefined || value.resolution === null || isNamedFieldRecord(value.resolution)) &&
    (value.reporter === undefined || value.reporter === null || isReporterFieldRecord(value.reporter))
  );
}

function normalizeBaseURL(baseURL: string | null): string | null {
  if (baseURL === null) {
    return null;
  }

  const trimmed = baseURL.trim();
  if (!trimmed) {
    throw new Error("Jira base URL is required.");
  }
  if (trimmed !== baseURL) {
    throw new Error("Jira base URL must not include surrounding whitespace.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) {
    throw new Error("Jira base URL must not include control characters.");
  }
  if (hasUnsafeURLPathSegments(trimmed)) {
    throw new Error("Jira base URL must not include dot path segments.");
  }

  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Jira base URL must be a valid https:// URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Jira base URL must use https://.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Jira base URL must not include credentials.");
  }
  if (parsed.port) {
    throw new Error("Jira base URL must not include a port.");
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Jira base URL must be the site root, for example https://your-company.atlassian.net.");
  }

  return parsed.origin;
}

export function baseURLEnvOverrideState(
  raw: string | undefined | null = process.env[requiredSettingEnvVar(baseURLField)],
): "missing" | "valid" | "invalid" {
  if (raw === undefined || raw === null) {
    return "missing";
  }

  try {
    normalizeBaseURL(raw);
    return "valid";
  } catch {
    return "invalid";
  }
}

export function cloudIDEnvOverrideState(
  raw: string | undefined | null = process.env[requiredSettingEnvVar(cloudIDField)],
): "missing" | "valid" | "invalid" {
  if (raw === undefined || raw === null) {
    return "missing";
  }

  try {
    validateCloudID(raw);
    return "valid";
  } catch {
    return "invalid";
  }
}

function validateIssueKey(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(value)) {
    throw new Error("Jira API response included an invalid issue key.");
  }

  return value.toUpperCase();
}

function validateNextPageToken(body: Record<string, unknown>): string | null {
  const token = body.nextPageToken;
  if (token === undefined) {
    if (body.isLast === false) {
      throw new Error("Jira search response reported more pages without a nextPageToken.");
    }

    return null;
  }
  if (!isTextValue(token)) {
    throw new Error("Jira search response nextPageToken must be non-empty text without surrounding whitespace or control characters.");
  }

  return token;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return value;
}

function htmlTitle(text: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  if (!match) {
    return null;
  }

  const title = match[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? "";
  return title.length > 0 ? inlineErrorText(title) : null;
}

async function jiraErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return "Jira API error response body was empty.";
  }
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    const title = htmlTitle(text);
    return title === null
      ? "Jira API returned HTML instead of JSON."
      : `Jira API returned HTML instead of JSON: ${title}.`;
  }

  try {
    const body: unknown = JSON.parse(text);
    if (!isRecord(body)) {
      return "Jira API error response must be a JSON object.";
    }

    if (Object.hasOwn(body, "errorMessage")) {
      return isTextValue(body.errorMessage)
        ? body.errorMessage
        : "Jira API error response errorMessage must be non-empty text without surrounding whitespace or control characters.";
    }

    const messages = body.errorMessages;
    if (messages !== undefined) {
      if (!Array.isArray(messages)) {
        return "Jira API error response errorMessages must be an array.";
      }
      if (messages.length === 0) {
        return "Jira API error response errorMessages must include at least one message.";
      }
      if (!messages.every(isTextValue)) {
        return "Jira API error response errorMessages must contain non-empty text without surrounding whitespace or control characters.";
      }
      return messages[0] as string;
    }

    return "Jira API error response must include errorMessage or errorMessages.";
  } catch {
    return inlineErrorText(text);
  }
}

async function parseJiraJSON(response: Response, responseName: string): Promise<unknown> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new Error(`${responseName} must be valid JSON.`);
  }
}

export async function listOpenTickets(): Promise<JiraTicket[]> {
  const settings = resolveSettings();
  if (!settings) {
    throw new Error(
      "Jira not configured. Save credentials with `triage-companion jira credentials <base-url> <email> <token> [cloud-id]` " +
        "or set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, and optional JIRA_CLOUD_ID. " +
        `Required permissions: ${jiraPermissionText}`,
    );
  }

  const issues: JiraTicket[] = [];
  let nextPageToken: string | null = null;
  let startAt = 0;
  const seenPageTokens = new Set<string>();
  const apiKind = jiraAPIKind(settings);

  while (true) {
    const params = new URLSearchParams({
      jql: JQL,
      fields: ISSUE_FIELDS,
      maxResults: String(MAX_PAGE_SIZE),
    });
    if (apiKind === "data-center") {
      params.set("startAt", String(startAt));
    } else if (nextPageToken !== null) {
      params.set("nextPageToken", nextPageToken);
    }

    const url = `${jiraAPIBaseURL(settings)}${jiraSearchPath(settings)}?${params}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: authHeader(settings),
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      });
    } catch (error) {
      const message = inlineErrorText(error instanceof Error ? error.message : String(error));
      throw new Error(`Could not load Jira search response: ${message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      const message = await jiraErrorMessage(response);
      throw new Error(`Jira API error (${response.status}): ${message}`);
    }

    const body = await parseJiraJSON(response, "Jira search response");
    const rawIssues = isRecord(body) ? body.issues : undefined;
    if (!isRecord(body) || !Array.isArray(rawIssues)) {
      throw new Error("Jira search response must include an issues array.");
    }

    const issueRecords = rawIssues.filter(isRecord);
    if (issueRecords.length !== rawIssues.length) {
      throw new Error("Jira search response issues must be objects.");
    }
    if (rawIssues.length > MAX_PAGE_SIZE) {
      throw new Error("Jira search response issue count exceeded the requested page size.");
    }

    for (const issue of issueRecords) {
      if (issue.key === undefined) {
        throw new Error("Jira API response included an issue without a key.");
      }
      if (typeof issue.key !== "string") {
        throw new Error("Jira API response issue key must be a string.");
      }

      const key = validateIssueKey(issue.key);
      const fields = recordField(issue, "fields");
      if (!fields) {
        throw new Error(`Jira API response issue ${key} fields must be an object.`);
      }
      if (!isIssueFieldsResponse(fields)) {
        throw new Error(`Jira API response issue ${key} fields must include valid top-level values.`);
      }
      if (fields.resolution !== null && fields.resolution !== undefined) {
        throw new Error(`Jira API response issue ${key} must be unresolved.`);
      }

      const reporter = recordField(fields, "reporter");
      const updatedText = fields.updated as string;
      const updated = parseDate(updatedText);
      if (!updated) {
        throw new Error(`Jira API response issue ${key} updated must be a valid date string.`);
      }
      issues.push({
        key,
        issueType: stringField(recordField(fields, "issuetype"), "name") as string,
        status: stringField(recordField(fields, "status"), "name") as string,
        priority: stringField(recordField(fields, "priority"), "name") ?? null,
        reporter: stringField(reporter, "displayName") ?? stringField(reporter, "emailAddress") ?? null,
        updatedAt: updated,
        updatedText: updated.toLocaleString(),
        summary: fields.summary as string,
        url: `${settings.baseURL}/browse/${key}`,
      });
    }

    if (apiKind === "data-center") {
      const responseStartAt = optionalNonNegativeInteger(body.startAt, "Jira search response startAt");
      const total = optionalNonNegativeInteger(body.total, "Jira search response total");
      if (responseStartAt !== null && responseStartAt !== startAt) {
        throw new Error("Jira search response startAt did not match the requested page.");
      }

      startAt += rawIssues.length;
      if (rawIssues.length === 0 || rawIssues.length < MAX_PAGE_SIZE || (total !== null && startAt >= total)) {
        break;
      }
      continue;
    }

    nextPageToken = validateNextPageToken(body);
    if (nextPageToken === null) {
      break;
    }
    if (rawIssues.length === 0) {
      throw new Error("Jira search response returned an empty page before pagination finished.");
    }
    if (seenPageTokens.has(nextPageToken)) {
      throw new Error("Jira search pagination repeated a previously fetched page.");
    }

    seenPageTokens.add(nextPageToken);
  }

  return issues.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

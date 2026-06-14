import * as creds from "../credential-store.ts";
import { ENV } from "../config.ts";
import { getServiceDefinition, getServiceSetting, hasUnsafeURLPathSegments } from "../config-model.ts";

const SERVICE = "Triage Companion-Jira";
const baseURLField = getServiceSetting("jira", "baseURL");
const emailField = getServiceSetting("jira", "email");
const apiTokenField = getServiceSetting("jira", "apiToken");

const ACCOUNT_BASE_URL = baseURLField.storage?.account ?? "base-url";
const ACCOUNT_EMAIL = emailField.storage?.account ?? "email";
const ACCOUNT_TOKEN = apiTokenField.storage?.account ?? "api-token";
const MAX_PAGE_SIZE = 100;
const ISSUE_FIELDS = "summary,status,priority,issuetype,reporter,updated,resolution";
const JQL =
  "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
const USER_AGENT = "triage-companion";
const jiraPermissionText = getServiceDefinition("jira").status.permissionRequirements
  .map((requirement) => `${requirement.feature}: ${requirement.permissions.join(", ")}`)
  .join("; ");

interface JiraSettings {
  baseURL: string;
  email: string;
  apiToken: string;
}

interface JiraTicket {
  key: string;
  issueType: string;
  status: string;
  priority: string;
  reporter: string | null;
  updatedAt: Date | null;
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

function resolveSettings(): JiraSettings | null {
  const base = normalizeBaseURL(
    readSettingWithEnvironmentOverride(ACCOUNT_BASE_URL, baseURLField.envVar ?? ENV.JIRA_BASE_URL),
  );
  const rawEmail = readSettingWithEnvironmentOverride(ACCOUNT_EMAIL, emailField.envVar ?? ENV.JIRA_EMAIL);
  const rawApiToken = readSettingWithEnvironmentOverride(
    ACCOUNT_TOKEN,
    apiTokenField.envVar ?? ENV.JIRA_API_TOKEN,
  );

  if (!base || rawEmail === null || rawApiToken === null) {
    return null;
  }

  const email = validateConfiguredText(rawEmail, "Jira email");
  const apiToken = validateConfiguredText(rawApiToken, "Jira API token");

  return {
    baseURL: base,
    email,
    apiToken,
  };
}

export function hasCredentials(): boolean {
  try {
    return resolveSettings() !== null;
  } catch {
    return false;
  }
}

export function saveCredentials(baseURL: string, email: string, apiToken: string): void {
  const normalized = normalizeBaseURL(baseURL);
  if (!normalized) {
    throw new Error("Jira base URL is required.");
  }

  const validatedEmail = validateConfiguredText(email, "Jira email");
  const validatedToken = validateConfiguredText(apiToken, "Jira API token");

  creds.updateMany([
    { service: SERVICE, account: ACCOUNT_BASE_URL, value: normalized },
    { service: SERVICE, account: ACCOUNT_EMAIL, value: validatedEmail },
    { service: SERVICE, account: ACCOUNT_TOKEN, value: validatedToken },
  ]);
}

export function removeCredentials(): void {
  creds.updateMany([
    { service: SERVICE, account: ACCOUNT_BASE_URL, value: null },
    { service: SERVICE, account: ACCOUNT_EMAIL, value: null },
    { service: SERVICE, account: ACCOUNT_TOKEN, value: null },
  ]);
}

function authHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

function parseDate(value: string | undefined): Date | null {
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

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function isTextValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim() === value &&
    !/[\u0000-\u001F\u007F-\u009F]/.test(value)
  );
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
    isNamedFieldRecord(value.priority) &&
    (value.resolution === undefined || value.resolution === null || isNamedFieldRecord(value.resolution)) &&
    (value.reporter === undefined || isReporterFieldRecord(value.reporter))
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
  raw: string | undefined | null = process.env[baseURLField.envVar ?? ENV.JIRA_BASE_URL],
): "missing" | "valid" | "invalid" {
  if (raw === undefined || raw === null) {
    return "missing";
  }

  try {
    return normalizeBaseURL(raw) ? "valid" : "invalid";
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

function validateSearchPagination(body: Record<string, unknown>): {
  startAt: number;
  maxResults: number;
  total: number;
} {
  const { startAt, maxResults, total } = body;
  if (
    typeof startAt !== "number" ||
    typeof maxResults !== "number" ||
    typeof total !== "number" ||
    !Number.isSafeInteger(startAt) ||
    !Number.isSafeInteger(maxResults) ||
    !Number.isSafeInteger(total) ||
    startAt < 0 ||
    maxResults <= 0 ||
    total < 0
  ) {
    throw new Error("Jira search response must include valid pagination numbers.");
  }

  return {
    startAt,
    maxResults,
    total,
  };
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

async function jiraErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return "Jira API error response body was empty.";
  }

  try {
    const body: unknown = JSON.parse(text);
    if (!isRecord(body)) {
      return "Jira API error response must be a JSON object.";
    }

    if (Object.hasOwn(body, "errorMessage")) {
      return typeof body.errorMessage === "string" && isTextValue(body.errorMessage)
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
      "Jira not configured. Save credentials with `triage-companion jira credentials <base-url> <email> <token>` " +
        "or set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN. " +
        `Required permissions: ${jiraPermissionText}`,
    );
  }

  const issues: JiraTicket[] = [];
  let startAt = 0;

  while (true) {
    const params = new URLSearchParams({
      jql: JQL,
      fields: ISSUE_FIELDS,
      startAt: String(startAt),
      maxResults: String(MAX_PAGE_SIZE),
    });

    const url = `${settings.baseURL}/rest/api/3/search?${params}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: authHeader(settings.email, settings.apiToken),
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
    const pagination = validateSearchPagination(body);
    if (pagination.startAt !== startAt) {
      throw new Error("Jira search response pagination startAt did not match the requested page.");
    }

    const issueRecords = rawIssues.filter(isRecord);
    if (issueRecords.length !== rawIssues.length) {
      throw new Error("Jira search response issues must be objects.");
    }
    if (rawIssues.length > pagination.maxResults) {
      throw new Error("Jira search response issue count exceeded the returned page size.");
    }
    if (pagination.startAt + rawIssues.length > pagination.total) {
      throw new Error("Jira search response issue count exceeded the reported total.");
    }

    for (const issue of issueRecords) {
      if (!("key" in issue) || issue.key === undefined) {
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
      if ("resolution" in fields && fields.resolution !== null && fields.resolution !== undefined) {
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
        priority: stringField(recordField(fields, "priority"), "name") as string,
        reporter: stringField(reporter, "displayName") ?? stringField(reporter, "emailAddress") ?? null,
        updatedAt: updated,
        updatedText: updated.toLocaleString(),
        summary: fields.summary as string,
        url: `${settings.baseURL}/browse/${key}`,
      });
    }

    if (rawIssues.length === 0) {
      if (pagination.startAt < pagination.total) {
        throw new Error("Jira search response returned an empty page before reaching the reported total.");
      }
      break;
    }

    const next = pagination.startAt + rawIssues.length;
    if (next >= pagination.total) {
      break;
    }

    startAt = next;
  }

  return issues.sort((left, right) => {
    const leftTime = left.updatedAt?.getTime() ?? 0;
    const rightTime = right.updatedAt?.getTime() ?? 0;
    return rightTime - leftTime;
  });
}

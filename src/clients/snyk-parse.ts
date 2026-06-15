import type { SnykRecord } from "./snyk-types.ts";

const US_SNYK_APP_HOSTS = new Set(["app.snyk.io", "app.us.snyk.io"]);

export function inlineErrorText(text: string): string {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

export function isSnykRecord(value: unknown): value is SnykRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.id === undefined || typeof value.id === "string") &&
    (value.attributes === undefined || isRecord(value.attributes)) &&
    (value.relationships === undefined || isRecord(value.relationships))
  );
}

export function pickString(value: unknown, keys: readonly string[]): string | null {
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

export function invalidStringCandidate(
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

export function validatedStringCandidate(
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

export function parseDate(value: string | null | undefined): Date | null {
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

export function scanItemRelationship(
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

export function validateAPIPathID(value: string, context: string): string {
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
  const pathEnd = pathEndCandidates.length > 0
    ? Math.min(...pathEndCandidates)
    : pathAndSuffix.length;
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

export function validateSnykIssueURL(
  value: string,
  issueId: string,
  organizationSlug: string,
  projectID: string | null,
): string {
  const safeOrganizationSlug = validateAPIPathID(organizationSlug, "Snyk organization slug");
  const safeProjectID = projectID ? validateAPIPathID(projectID, "Snyk project ID") : null;
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
      throw new Error(
        `Snyk issue URL without a project relationship must link to organization issues page ${safeOrganizationSlug}: ${issueId}`,
      );
    }
  }

  return url.href;
}

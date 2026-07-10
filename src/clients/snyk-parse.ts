import { snykAppOriginForAPIBaseURL } from "../config-model.ts";
import { inlineErrorText, isRecord, parseDate } from "../text.ts";

export { inlineErrorText, isRecord, parseDate };
import type { SnykRecord } from "./snyk-types.ts";

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

export function requiredProjectID(item: SnykRecord, context: string): string {
  const relationship = item.relationships?.scan_item;
  if (relationship === undefined) {
    throw new Error(`${context} must include a scan_item relationship.`);
  }
  if (!isRecord(relationship)) {
    throw new Error(`${context} scan_item relationship must be an object.`);
  }

  const data = relationship.data;
  if (!isRecord(data)) {
    throw new Error(`${context} scan_item relationship data must be an object.`);
  }

  const type = data.type;
  if (typeof type !== "string") {
    throw new Error(`${context} scan_item relationship must include a type.`);
  }
  if (type !== "project") {
    throw new Error(`${context} scan_item relationship type must be project.`);
  }

  const id = data.id;
  if (typeof id !== "string") {
    throw new Error(`${context} scan_item relationship must include a project id.`);
  }

  return validateAPIPathID(id, "Snyk project ID");
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

export function snykIssueWebURL(
  apiBaseURL: string,
  organizationSlug: string,
  projectID: string,
  issueKey: string,
): string {
  const appOrigin = snykAppOriginForAPIBaseURL(apiBaseURL);
  const safeOrganizationSlug = validateAPIPathID(organizationSlug, "Snyk organization slug");
  const safeProjectID = validateAPIPathID(projectID, "Snyk project ID");
  return `${appOrigin}/org/${safeOrganizationSlug}/project/${safeProjectID}#issue-${encodeURIComponent(issueKey)}`;
}

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
import { KNOWN_SEVERITIES, normalizedKnownSeverity } from "../severity.ts";
import { validateAPIPathID } from "./snyk-parse.ts";

const tokenField = getServiceSetting("snyk", "token");
const apiBaseURLField = getServiceSetting("snyk", "apiBaseURL");
const SERVICE = tokenField.storage?.service ?? "Triage Companion-Snyk";
const ACCOUNT = tokenField.storage?.account ?? "token";
const API_BASE_URL_SERVICE = apiBaseURLField.storage?.service ?? "Triage Companion-Config";
const API_BASE_URL_ACCOUNT = apiBaseURLField.storage?.account ?? "snyk-api-base-url";

export const snykPermissionText = getServiceDefinition("snyk").status.permissionRequirements
  .map((requirement) => `${requirement.feature}: ${requirement.permissions.join(", ")}`)
  .join("; ");

export function validateSeverityFilter(value: string | undefined): string | undefined {
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

export function resolveBaseURL(): string {
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

export function resolveToken(): string | null {
  const token = creds.readCredential(SERVICE, ACCOUNT, tokenField.envVar ?? ENV.SNYK_TOKEN);
  return token !== null ? validateConfiguredText(token, "Snyk token") : null;
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
  return resolveBaseURL();
}

export function configuredOrgIDs(): string[] {
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

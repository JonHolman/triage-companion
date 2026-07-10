import * as creds from "../credential-store.ts";
import { ENV } from "../config.ts";
import {
  DEFAULT_SNYK_API_BASE_URL,
  getServiceDefinition,
  getServiceSetting,
  hasUnsafeURLPathSegments,
  normalizeSnykAPIBaseURL,
  requiredSettingEnvVar,
  requiredSettingStorage,
  US_SNYK_API_BASE_URLS,
} from "../config-model.ts";
import { KNOWN_SEVERITIES, normalizedKnownSeverity } from "../severity.ts";
import { validateConfiguredText } from "../text.ts";
import { validateAPIPathID } from "./snyk-parse.ts";

const tokenField = getServiceSetting("snyk", "token");
const apiBaseURLField = getServiceSetting("snyk", "apiBaseURL");
const tokenStorage = requiredSettingStorage(tokenField);
const apiBaseURLStorage = requiredSettingStorage(apiBaseURLField);
const SERVICE = tokenStorage.service;
const ACCOUNT = tokenStorage.account;
const API_BASE_URL_SERVICE = apiBaseURLStorage.service;
const API_BASE_URL_ACCOUNT = apiBaseURLStorage.account;

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
  const envVar = requiredSettingEnvVar(apiBaseURLField);
  if (Object.hasOwn(process.env, envVar)) {
    return validateAPIBaseURL(process.env[envVar] ?? "");
  }

  const storedValue = creds.read(API_BASE_URL_SERVICE, API_BASE_URL_ACCOUNT);
  return validateAPIBaseURL(storedValue ?? DEFAULT_SNYK_API_BASE_URL);
}

export function apiBaseURLEnvOverrideState(
  raw: string | undefined | null = process.env[requiredSettingEnvVar(apiBaseURLField)],
): "missing" | "valid" | "invalid" {
  if (raw === undefined || raw === null) {
    return "missing";
  }

  try {
    validateAPIBaseURL(raw);
    return "valid";
  } catch {
    return "invalid";
  }
}

export function resolveToken(): string | null {
  const token = creds.readCredential(SERVICE, ACCOUNT, requiredSettingEnvVar(tokenField));
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

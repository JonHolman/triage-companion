import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { US_SNYK_API_BASE_URLS } from "./config-model-core.ts";
import { expandHomePath } from "./home-path.ts";

const GIT_VERSION_CHECK_TIMEOUT_MS = 5000;

function trim(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function parseJSONStringArray(
  raw: string | undefined | null,
  label: string,
): string[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (raw.trim().length === 0) {
    return [];
  }
  if (raw.trim() !== raw) {
    throw new Error(`${label} must not include surrounding whitespace.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be a JSON array of non-empty strings.`);
  }

  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string" || value.trim().length === 0)
  ) {
    throw new Error(`${label} must be a JSON array of non-empty strings.`);
  }

  return parsed;
}

export function validateGitSearchRootEntries(roots: readonly string[]): string | null {
  if (roots.some((root) => root.trim() !== root)) {
    return "must contain paths without surrounding whitespace";
  }

  return roots.some((root) => /[\u0000-\u001F\u007F-\u009F]/.test(root))
    ? "must contain paths without control characters"
    : null;
}

export function gitSearchRootsList(value: string): string | null {
  if (value.trim().length === 0) {
    return "must be a JSON array of non-empty strings";
  }
  if (value.trim() !== value) {
    return "must not include surrounding whitespace";
  }

  let roots: string[];
  try {
    roots = parseJSONStringArray(value, "Git search roots");
  } catch {
    return "must be a JSON array of non-empty strings";
  }

  return validateGitSearchRootEntries(roots);
}

export function validateGitHubIgnoredBranchNames(branches: readonly string[]): string | null {
  if (branches.some((branch) => /[\u0000-\u001F\u007F-\u009F]/.test(branch))) {
    return "must contain branch names without control characters";
  }

  return branches.every((branch) => branch.trim() === branch)
    ? null
    : "must contain branch names without surrounding whitespace";
}

export function gitHubIgnoredBranchList(value: string): string | null {
  if (value.trim().length > 0 && value.trim() !== value) {
    return "must not include surrounding whitespace";
  }

  let branches: string[];
  try {
    branches = parseJSONStringArray(value, "GitHub ignored branch list");
  } catch {
    return "must be a JSON array of branch names";
  }

  return validateGitHubIgnoredBranchNames(branches);
}

export function nonEmpty(value: string): string | null {
  if (value.trim().length === 0) {
    return "must not be empty";
  }
  if (value.trim() !== value) {
    return "must not include surrounding whitespace";
  }

  return /[\u0000-\u001F\u007F-\u009F]/.test(value)
    ? "must not include control characters"
    : null;
}

export function validateRegularExpression(value: string): string | null {
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    return "must not include control characters";
  }

  try {
    new RegExp(value);
    return null;
  } catch {
    return "must be a valid regular expression";
  }
}

function safeAPIPathSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}

export function safeCommaSeparatedAPIPathSegments(value: string): string | null {
  const entries = value.split(",");
  const trimmedEntries = entries.map((entry) => entry.trim());
  if (trimmedEntries.every((entry) => entry.length === 0)) {
    return "must include at least one ID";
  }

  if (trimmedEntries.some((entry) => entry.length === 0)) {
    return "must contain safe IDs separated by commas";
  }

  if (entries.some((entry, index) => entry !== trimmedEntries[index])) {
    return "must contain IDs without surrounding whitespace";
  }

  return trimmedEntries.every(safeAPIPathSegment)
    ? null
    : "must contain safe IDs separated by commas";
}

export function executablePath(value: string): string | null {
  let expanded: string;
  try {
    expanded = expandHomePath(value);
  } catch (error) {
    return error instanceof Error ? error.message : "must point to an executable path";
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(expanded);
  } catch {
    return "must point to an executable path";
  }

  if (!stat.isFile()) {
    return "must point to an executable path";
  }

  try {
    fs.accessSync(expanded, fs.constants.X_OK);
  } catch {
    return "must point to an executable path";
  }

  try {
    const output = execFileSync(expanded, ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_VERSION_CHECK_TIMEOUT_MS,
    }).replace(/[\r\n]+$/, "");
    return output.trim() === output && /^git version \d/i.test(output)
      ? null
      : "must point to a git executable";
  } catch {
    return "must point to a git executable";
  }
}

export function normalizeSnykAPIBaseURL(value: string): string {
  const trimmed = value.trim();
  try {
    return new URL(trimmed).href.replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

// Backslashes count as path separators because the WHATWG URL parser treats
// them that way in https URLs.
const URL_PATH_SEPARATORS = /[/\\]/;

export function hasUnsafeURLPathSegments(value: string): boolean {
  const schemeIndex = value.indexOf("://");
  const searchFrom = schemeIndex === -1 ? 0 : schemeIndex + 3;
  const relativePathStart = value.slice(searchFrom).search(URL_PATH_SEPARATORS);
  const pathAndSuffix = relativePathStart === -1
    ? "/"
    : value.slice(searchFrom + relativePathStart);
  const searchIndex = pathAndSuffix.indexOf("?");
  const hashIndex = pathAndSuffix.indexOf("#");
  const pathEndCandidates = [searchIndex, hashIndex].filter((index) => index >= 0);
  const pathEnd = pathEndCandidates.length > 0
    ? Math.min(...pathEndCandidates)
    : pathAndSuffix.length;
  const rawPath = pathAndSuffix.slice(0, pathEnd);

  try {
    const parts = rawPath.split(URL_PATH_SEPARATORS);
    const hasTrailingSlash = parts[parts.length - 1] === "";
    const segments = hasTrailingSlash ? parts.slice(1, -1) : parts.slice(1);
    return segments.some((part) => {
      if (part.length === 0) {
        return true;
      }

      const decoded = decodeURIComponent(part);
      return decoded === "." || decoded === "..";
    });
  } catch {
    return true;
  }
}

export function usSnykAPIBaseURL(value: string): string | null {
  if (value.trim() !== value) {
    return "must not include surrounding whitespace";
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    return "must not include control characters";
  }
  if (hasUnsafeURLPathSegments(value)) {
    return "must not include dot path segments";
  }
  const normalized = normalizeSnykAPIBaseURL(value);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return "must be a valid https:// URL";
  }

  if (parsed.username || parsed.password) {
    return "must not include credentials";
  }

  if (parsed.port) {
    return "must not include a port";
  }

  if (normalized === "https://api.snykgov.io/rest") {
    return "Snyk Gov requires OAuth and is not supported by this token-based client";
  }

  return (US_SNYK_API_BASE_URLS as readonly string[]).includes(normalized)
    ? null
    : `must be one of the US REST API base URLs: ${US_SNYK_API_BASE_URLS.join(", ")}`;
}

export function jiraHTTPSBaseURL(value: string): string | null {
  const normalized = trim(value);
  if (!normalized) {
    return "must not be empty";
  }
  if (normalized !== value) {
    return "must not include surrounding whitespace";
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    return "must not include control characters";
  }
  if (hasUnsafeURLPathSegments(normalized)) {
    return "must not include dot path segments";
  }

  const withScheme = normalized.includes("://") ? normalized : `https://${normalized}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "https:") {
      return "must use https://";
    }

    if (parsed.username || parsed.password) {
      return "must not include credentials";
    }

    if (parsed.port) {
      return "must not include a port";
    }

    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return "must be the Jira site root, for example https://your-company.atlassian.net";
    }

    return null;
  } catch {
    return "must be a valid https:// URL";
  }
}

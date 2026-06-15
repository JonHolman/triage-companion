import { GITHUB_API_HOST } from "./github-constants.ts";

export function validatedGitHubAPIURL(value: string): URL {
  if (value.trim() !== value) {
    throw new Error("GitHub API URL must not include surrounding whitespace.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error("GitHub API URL must not include control characters.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`GitHub API URL must be a valid https://${GITHUB_API_HOST} URL.`);
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== GITHUB_API_HOST) {
    throw new Error(`GitHub API URL must use https://${GITHUB_API_HOST}.`);
  }
  if (parsed.port) {
    throw new Error("GitHub API URL must not include a port.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("GitHub API URL must not include credentials.");
  }
  if (parsed.hash) {
    throw new Error("GitHub API URL must not include fragments.");
  }

  return parsed;
}

export function isPositiveIntegerText(value: string | undefined): boolean {
  return Boolean(value && /^[1-9]\d*$/.test(value));
}

export function parsePositiveSafeIntegerText(value: string | undefined): number | null {
  if (value === undefined || !isPositiveIntegerText(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function isPositiveSafeIntegerValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isGitObjectIDText(value: string | undefined): boolean {
  return Boolean(value && /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(value));
}

export function validatePositiveIntegerOption(
  value: number,
  label: string,
  { allowInfinity = false }: { allowInfinity?: boolean } = {},
): number {
  if (allowInfinity && value === Number.POSITIVE_INFINITY) {
    return value;
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function decodedRawURLPathSegments(value: string): string[] | null {
  const schemeIndex = value.indexOf("//");
  if (schemeIndex === -1) {
    return null;
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
      return null;
    }

    const hasTrailingSlash = parts[parts.length - 1] === "";
    const segments = hasTrailingSlash ? parts.slice(1, -1) : parts.slice(1);
    if (segments.some((part) => part.length === 0)) {
      return null;
    }

    return segments.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
}

export function rawGitHubPathSegments(value: string): string[] | null {
  const segments = decodedRawURLPathSegments(value);
  if (segments === null || segments.some((part) => part === "." || part === "..")) {
    return null;
  }

  return segments;
}

export function validateRepositoryFullName(value: string): string {
  if (value.trim() !== value) {
    throw new Error("GitHub repository must be in owner/repo form.");
  }

  const parts = value.split("/");
  const owner = parts[0] ?? "";
  const repo = parts[1] ?? "";
  const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
  const repoPattern = /^[A-Za-z0-9._-]+$/;
  if (
    parts.length !== 2 ||
    !ownerPattern.test(owner) ||
    !repoPattern.test(repo) ||
    repo === "." ||
    repo === ".."
  ) {
    throw new Error("GitHub repository must be in owner/repo form.");
  }

  return `${owner}/${repo}`;
}

export function validateNotificationThreadID(value: string): string {
  if (!isPositiveIntegerText(value)) {
    throw new Error("GitHub notification thread ID must be a positive number.");
  }

  return value;
}

export function validatePullRequestAPIURL(
  value: string,
  expectedRepositoryFullName?: string,
): string {
  const parsed = validatedGitHubAPIURL(value);
  if (parsed.search) {
    throw new Error("GitHub notification pull request URL must not include query strings.");
  }

  const parts = rawGitHubPathSegments(value);
  const isPullRequestPath =
    parts !== null &&
    parts.length === 5 &&
    parts[0] === "repos" &&
    parts[3] === "pulls" &&
    isPositiveIntegerText(parts[4]);

  if (!isPullRequestPath) {
    throw new Error("GitHub notification pull request URL is not a GitHub pull request API URL.");
  }

  const repositoryFullName = validateRepositoryFullName(`${parts[1]}/${parts[2]}`);
  if (
    expectedRepositoryFullName &&
    repositoryFullName.toLowerCase() !== expectedRepositoryFullName.toLowerCase()
  ) {
    throw new Error("GitHub notification pull request URL must stay in the notification repository.");
  }

  return parsed.href;
}

export function repositoryFullNameFromURL(repositoryURL: string): string | null {
  try {
    const url = new URL(repositoryURL);
    if (url.hostname !== "github.com") {
      return null;
    }

    const parts = rawGitHubPathSegments(repositoryURL);
    if (!parts || parts.length !== 2) {
      return null;
    }

    return validateRepositoryFullName(`${parts[0]}/${parts[1]}`);
  } catch {
    return null;
  }
}

export function parseGitHubDate(value: string | undefined): Date | null {
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

export function requireGitHubWebURL(value: string | null, context: string): string {
  if (!value) {
    throw new Error(`${context} missing GitHub web URL.`);
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error(`${context} must not include control characters.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${context} must be a valid https://github.com URL.`);
  }

  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error(`${context} must link to https://github.com.`);
  }
  if (url.port) {
    throw new Error(`${context} must not include a port.`);
  }
  if (url.username || url.password) {
    throw new Error(`${context} must not include credentials.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${context} must not include query strings or fragments.`);
  }

  return url.href;
}

export function requireGitHubRepositoryWebURL(
  value: string | null,
  context: string,
  repositoryFullName: string,
): string {
  const href = requireGitHubWebURL(value, context);
  const parts = value ? rawGitHubPathSegments(value) : null;
  if (!parts || parts.length < 2) {
    throw new Error(`${context} must include a GitHub owner/repo path.`);
  }

  let linkedRepository: string;
  try {
    linkedRepository = validateRepositoryFullName(`${parts[0]}/${parts[1]}`);
  } catch {
    throw new Error(`${context} must include a GitHub owner/repo path.`);
  }

  if (linkedRepository.toLowerCase() !== repositoryFullName.toLowerCase()) {
    throw new Error(`${context} must link to ${repositoryFullName}.`);
  }

  return href;
}

export function requireGitHubRepositoryLinkURL(
  value: string | null,
  context: string,
  repositoryFullName: string,
): string {
  return requireGitHubRepositoryWebURL(value, context, repositoryFullName);
}

export function requireGitHubRepositoryRootURL(
  value: string | null,
  context: string,
  repositoryFullName: string,
): string {
  const href = requireGitHubRepositoryWebURL(value, context, repositoryFullName);
  const parts = value ? rawGitHubPathSegments(value) : null;
  if (!parts || parts.length !== 2) {
    throw new Error(`${context} must link to the GitHub repository root.`);
  }

  return href;
}

export function requireDependabotAlertWebURL(
  value: string | null,
  context: string,
  repositoryFullName: string,
  expectedAlertNumber: number | undefined,
): string {
  if (!Number.isSafeInteger(expectedAlertNumber) || (expectedAlertNumber ?? 0) <= 0) {
    throw new Error(`${context} missing Dependabot alert number.`);
  }

  const href = requireGitHubRepositoryWebURL(value, context, repositoryFullName);
  const parts = value ? rawGitHubPathSegments(value) : null;
  if (
    !parts ||
    parts.length !== 5 ||
    parts[2] !== "security" ||
    parts[3] !== "dependabot" ||
    !isPositiveIntegerText(parts[4])
  ) {
    throw new Error(`${context} must link to a Dependabot alert.`);
  }

  if (parts[4] !== String(expectedAlertNumber)) {
    throw new Error(`${context} must link to Dependabot alert ${expectedAlertNumber}.`);
  }

  return href;
}

export function requireWorkflowRunWebURL(
  value: string | null,
  context: string,
  repositoryFullName: string,
  expectedRunID: number | undefined,
): string {
  if (!Number.isSafeInteger(expectedRunID) || (expectedRunID ?? 0) <= 0) {
    throw new Error(`${context} missing GitHub Actions workflow run ID.`);
  }

  const href = requireGitHubRepositoryWebURL(value, context, repositoryFullName);
  const parts = value ? rawGitHubPathSegments(value) : null;
  if (
    !parts ||
    parts.length !== 5 ||
    parts[2] !== "actions" ||
    parts[3] !== "runs" ||
    !isPositiveIntegerText(parts[4])
  ) {
    throw new Error(`${context} must link to a GitHub Actions workflow run.`);
  }

  if (parts[4] !== String(expectedRunID)) {
    throw new Error(`${context} must link to workflow run ${expectedRunID}.`);
  }

  return href;
}

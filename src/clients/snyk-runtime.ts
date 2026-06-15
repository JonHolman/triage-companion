import { US_SNYK_API_BASE_URLS } from "../config-model.ts";
import {
  inlineErrorText,
  invalidStringCandidate,
  isRecord,
  isSnykRecord,
  pickString,
  recordField,
} from "./snyk-parse.ts";
import type { SnykRecord } from "./snyk-types.ts";

const API_VERSION = "2024-10-15";
const PAGE_LIMIT = 100;
const USER_AGENT = "triage-companion";

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
  const pathEnd = pathEndCandidates.length > 0
    ? Math.min(...pathEndCandidates)
    : pathAndSuffix.length;
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

export async function paginate(
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

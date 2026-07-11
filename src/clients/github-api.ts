import {
  API_VERSION,
  GITHUB_API_HOST,
  USER_AGENT,
} from "./github-constants.ts";
import type {
  GhFetchOptions,
} from "./github-types.ts";
import {
  githubErrorMessage,
  hasCanonicalTextValue,
  inlineErrorText,
  isRecord,
  parseGitHubJSON,
  stringField,
} from "./github-response.ts";
import {
  rawGitHubPathSegments,
  validatedGitHubAPIURL,
} from "./github-url.ts";
import {
  resolveToken,
} from "./github-auth.ts";

export async function ghFetch(
  url: string,
  token: string | null,
  { method = "GET" }: GhFetchOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": USER_AGENT,
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(validatedGitHubAPIURL(url).href, {
    method,
    headers,
    redirect: "error",
  });
}

export async function ghFetchWithErrorContext(
  url: string,
  token: string | null,
  context: string,
  options?: GhFetchOptions,
): Promise<Response> {
  try {
    return await ghFetch(url, token, options);
  } catch (error) {
    const message = inlineErrorText(error instanceof Error ? error.message : String(error));
    throw new Error(`${context}: ${message}`, {
      cause: error,
    });
  }
}

function stableGitHubPaginationQuery(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.delete("page");
  params.delete("after");
  params.delete("before");
  params.sort();
  return params.toString();
}

function gitHubPaginationLoopKey(value: string): string {
  const url = validatedGitHubAPIURL(value);
  url.searchParams.sort();
  return url.href;
}

function validateGitHubPaginationURL(value: string, currentValue: string): string {
  const parsed = validatedGitHubAPIURL(value);
  const current = validatedGitHubAPIURL(currentValue);
  const path = rawGitHubPathSegments(value);
  const currentPath = rawGitHubPathSegments(currentValue);
  if (
    !path ||
    !currentPath ||
    path.length !== currentPath.length ||
    path.some((part, index) => part !== currentPath[index])
  ) {
    throw new Error("GitHub API pagination link must stay on the current API route.");
  }

  if (stableGitHubPaginationQuery(parsed) !== stableGitHubPaginationQuery(current)) {
    throw new Error("GitHub API pagination link must keep the current API query.");
  }

  return parsed.href;
}

function recordGitHubPaginationURL(
  seen: Set<string>,
  next: string,
  context: string,
): void {
  const nextKey = gitHubPaginationLoopKey(next);
  if (seen.has(nextKey)) {
    throw new Error(`${context} repeated a previously fetched page.`);
  }

  seen.add(nextKey);
}

interface GitHubPage<T> {
  items: T[];
  itemCount: number;
}

// Shared Link-header pagination loop: stops at the limit, fails on repeated
// pages and on empty non-final pages instead of silently truncating.
export async function collectGitHubPaginatedItems<T>(
  initialURL: string,
  limit: number,
  loadPage: (url: string) => Promise<{ response: Response; page: GitHubPage<T> }>,
  { emptyPageMessage, paginationContext }: { emptyPageMessage: string; paginationContext: string },
): Promise<T[]> {
  let url = initialURL;
  const seen = new Set<string>([gitHubPaginationLoopKey(url)]);
  const items: T[] = [];

  while (items.length < limit) {
    const { response, page } = await loadPage(url);
    items.push(...page.items);

    if (items.length >= limit) {
      break;
    }

    const rawNext = nextURL(response.headers.get("link"));
    const next = rawNext ? validateGitHubPaginationURL(rawNext, url) : null;
    if (!next) {
      break;
    }
    if (page.itemCount === 0) {
      throw new Error(emptyPageMessage);
    }

    recordGitHubPaginationURL(seen, next, paginationContext);
    url = next;
  }

  return items.slice(0, limit);
}

function nextURL(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    const pieces = part.split(";").map((item) => item.trim());
    if (pieces.some((piece) => piece === 'rel="next"')) {
      const urlPart = pieces[0];
      if (!urlPart?.startsWith("<") || !urlPart.endsWith(">")) {
        throw new Error("GitHub API pagination link must be a valid URL.");
      }

      return urlPart.slice(1, -1);
    }
  }

  return null;
}

export async function resolveAuthenticatedLogin(): Promise<string | null> {
  const token = resolveToken();
  if (!token) {
    return null;
  }

  const response = await ghFetchWithErrorContext(
    `https://${GITHUB_API_HOST}/user`,
    token,
    "Could not resolve the authenticated GitHub login",
  );

  if (!response.ok) {
    throw new Error(`GitHub API HTTP ${response.status}: ${await githubErrorMessage(response)}`);
  }

  const body = await parseGitHubJSON(response, "GitHub authenticated user response");
  if (!isRecord(body)) {
    throw new Error("GitHub authenticated user response must be an object.");
  }

  const login = stringField(body, "login");
  if (login === undefined) {
    throw new Error("GitHub authenticated user response must include a login.");
  }
  if (!hasCanonicalTextValue(login)) {
    throw new Error(
      "GitHub authenticated user response login must be non-empty text without surrounding whitespace or control characters.",
    );
  }

  return login;
}

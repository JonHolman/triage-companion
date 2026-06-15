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
  params.sort();
  return params.toString();
}

export function gitHubPaginationLoopKey(value: string): string {
  const url = validatedGitHubAPIURL(value);
  url.searchParams.sort();
  return url.href;
}

export function validateGitHubPaginationURL(value: string, currentValue: string): string {
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

export function recordGitHubPaginationURL(
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

export function nextURL(linkHeader: string | null): string | null {
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
  if (login.trim().length === 0) {
    throw new Error("GitHub authenticated user response login must not be empty.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(login)) {
    throw new Error("GitHub authenticated user response login must not include control characters.");
  }
  if (login.trim() !== login) {
    throw new Error("GitHub authenticated user response login must not include surrounding whitespace.");
  }

  return login;
}

import {
  githubPermissionText,
  resolveToken,
} from "./github-auth.ts";
import {
  GITHUB_API_HOST,
} from "./github-constants.ts";
import type {
  GitHubNotification,
  GitHubNotificationApi,
  PrDetails,
} from "./github-types.ts";
import {
  collectGitHubPaginatedItems,
  ghFetchWithErrorContext,
} from "./github-api.ts";
import {
  hasCanonicalTextValue,
  hasPullRequestSubjectURL,
  inlineErrorText,
  isNotificationResponse,
  isPullRequestDetailsResponse,
  isRecord,
  parseGitHubJSON,
  recordField,
  stringField,
  githubErrorMessage,
} from "./github-response.ts";
import {
  parseSubjectDetailAPIURL,
  parseSubjectURL,
  requireNotificationRepositoryFullName,
} from "./github-notification-parse.ts";
import {
  parseGitHubDate,
  requireGitHubRepositoryWebURL,
  requireGitHubRepositoryRootURL,
  requireGitHubWebURL,
  validateNotificationThreadID,
  validatePositiveIntegerOption,
  validatePullRequestAPIURL,
  validateRepositoryFullName,
} from "./github-url.ts";

async function fetchNotifications({
  maxResults = 200,
  includeRead = false,
}: {
  maxResults?: number;
  includeRead?: boolean;
} = {}): Promise<{ token: string; notifications: GitHubNotificationApi[] }> {
  const token = resolveToken();
  if (!token) {
    throw new Error(
      `GitHub token not configured. Save it with ` +
        "`triage-companion github token <token>` or set GITHUB_TOKEN. " +
        `Required permissions: ${githubPermissionText}`,
    );
  }

  const limit = validatePositiveIntegerOption(maxResults, "GitHub notification limit");
  const perPage = Math.min(limit, 100);
  const params = new URLSearchParams({
    all: includeRead ? "true" : "false",
    participating: "false",
    per_page: String(perPage),
  });

  const notifications = await collectGitHubPaginatedItems<GitHubNotificationApi>(
    `https://${GITHUB_API_HOST}/notifications?${params}`,
    limit,
    async (url) => {
      const res = await ghFetchWithErrorContext(
        url,
        token,
        "Could not fetch GitHub notifications",
      );
      if (res.status === 403) {
        const sso = res.headers.get("x-github-sso");
        if (sso?.includes("required")) {
          const urlMatch = sso.match(/url=([^;]+)/);
          throw new Error(
            `SSO authorization required. Visit: ${inlineErrorText(urlMatch?.[1] || "(check GitHub settings)")}`,
          );
        }
        throw new Error(
          `GitHub API HTTP 403: ${await githubErrorMessage(res)}. ` +
            "GitHub notifications require a classic personal access token with the notifications scope; " +
            "fine-grained personal access tokens are not supported by GitHub notification endpoints.",
        );
      }

      if (!res.ok) {
        throw new Error(`GitHub API HTTP ${res.status}: ${await githubErrorMessage(res)}`);
      }

      const page = await parseGitHubJSON(res, "GitHub notifications response");
      if (!Array.isArray(page)) {
        throw new Error("GitHub notifications response must be an array.");
      }
      const notificationPage = page.filter(isNotificationResponse);
      if (notificationPage.length !== page.length) {
        throw new Error("GitHub notifications response entries must be objects with valid top-level fields.");
      }
      if (!includeRead && notificationPage.some((notification) => notification.unread === false)) {
        throw new Error("GitHub notifications response returned a read notification despite all=false.");
      }

      return { response: res, page: { items: notificationPage, itemCount: notificationPage.length } };
    },
    {
      emptyPageMessage: "GitHub notifications response returned an empty page before pagination finished.",
      paginationContext: "GitHub notifications pagination",
    },
  );

  return { token, notifications };
}

// Notification detail lookups fan out in small batches so one slow request
// cannot stall the whole listing and one failure surfaces as the command
// error instead of being swallowed.
async function collectByIdInBatches<I, V>(
  refs: readonly I[],
  resolveRef: (ref: I) => Promise<{ id: string; value: V } | null>,
): Promise<Map<string, V>> {
  const byId = new Map<string, V>();
  const BATCH = 8;
  for (let index = 0; index < refs.length; index += BATCH) {
    const resolved = await Promise.allSettled(refs.slice(index, index + BATCH).map(resolveRef));
    for (const entry of resolved) {
      if (entry.status === "rejected") {
        throw entry.reason instanceof Error
          ? entry.reason
          : new Error(inlineErrorText(String(entry.reason)));
      }

      if (entry.value === null) {
        continue;
      }
      byId.set(entry.value.id, entry.value.value);
    }
  }

  return byId;
}

async function fetchPullRequestDetails(
  token: string,
  limited: GitHubNotificationApi[],
): Promise<Map<string, PrDetails>> {
  const pullRequestRefs = limited
    .filter(hasPullRequestSubjectURL)
    .map((notification) => ({
      id: validateNotificationThreadID(String(notification.id)),
      apiURL: notification.subject.url,
      repositoryFullName: requireNotificationRepositoryFullName(
        notification,
        validateNotificationThreadID(String(notification.id)),
      ),
    }));

  return collectByIdInBatches(pullRequestRefs, async ({ id, apiURL, repositoryFullName }) => {
    const expectedRepositoryFullName = validateRepositoryFullName(repositoryFullName);
    const response = await ghFetchWithErrorContext(
      validatePullRequestAPIURL(apiURL, expectedRepositoryFullName),
      token,
      `Could not fetch notification pull request ${id}`,
    );
    if (response.status === 403 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        `GitHub API HTTP ${response.status} for notification pull request ${id}: ${await githubErrorMessage(response)}`,
      );
    }

    const body = await parseGitHubJSON(response, "GitHub pull request details response");
    if (!isRecord(body)) {
      throw new Error("GitHub pull request details response must be an object.");
    }
    if (!isPullRequestDetailsResponse(body)) {
      throw new Error("GitHub pull request details response must be an object with valid top-level fields.");
    }

    const user = recordField(body, "user");
    return {
      id,
      value: {
        state: body.state as string,
        merged: body.merged as boolean,
        author: stringField(user, "login") ?? null,
      },
    };
  });
}

async function fetchSubjectWebURLs(
  token: string,
  limited: GitHubNotificationApi[],
): Promise<Map<string, string>> {
  const subjectDetailRefs = limited
    .map((notification) => {
      const id = validateNotificationThreadID(String(notification.id));
      const repositoryFullName = requireNotificationRepositoryFullName(notification, id);
      if (parseSubjectURL(notification)) {
        return null;
      }

      const apiURL = parseSubjectDetailAPIURL(notification, repositoryFullName);
      return apiURL ? { id, apiURL, repositoryFullName } : null;
    })
    .filter((value): value is { id: string; apiURL: string; repositoryFullName: string } => value !== null);

  return collectByIdInBatches(subjectDetailRefs, async ({ id, apiURL, repositoryFullName }) => {
    const response = await ghFetchWithErrorContext(
      apiURL,
      token,
      `Could not fetch notification subject details ${id}`,
    );
    if (!response.ok) {
      throw new Error(
        `GitHub API HTTP ${response.status} for notification subject details ${id}: ${await githubErrorMessage(response)}`,
      );
    }

    const body = await parseGitHubJSON(response, "GitHub notification subject details response");
    if (!isRecord(body)) {
      throw new Error("GitHub notification subject details response must be an object.");
    }

    const rawHtmlURL = body.html_url;
    if (rawHtmlURL === undefined) {
      throw new Error("GitHub notification subject details response must include an html_url.");
    }
    if (typeof rawHtmlURL !== "string") {
      throw new Error("GitHub notification subject details response html_url must be a string.");
    }
    const htmlURL = rawHtmlURL;
    if (!hasCanonicalTextValue(htmlURL)) {
      throw new Error(
        "GitHub notification subject details response html_url must not include surrounding whitespace.",
      );
    }

    return {
      id,
      value: requireGitHubRepositoryWebURL(
        htmlURL,
        `GitHub notification ${id} subject`,
        repositoryFullName,
        { allowFragment: true },
      ),
    };
  });
}

export async function listNotifications({
  maxResults = 200,
  includeRead = false,
}: {
  maxResults?: number;
  includeRead?: boolean;
} = {}): Promise<GitHubNotification[]> {
  const { token, notifications: limited } = await fetchNotifications({ maxResults, includeRead });
  const detailsById = await fetchPullRequestDetails(token, limited);
  const subjectWebURLsById = await fetchSubjectWebURLs(token, limited);

  return limited
    .map((notification) => {
      const notificationId = validateNotificationThreadID(String(notification.id));
      const details = detailsById.get(notificationId);
      const repositoryFullName = requireNotificationRepositoryFullName(notification, notificationId);
      const subjectURL = parseSubjectURL(notification) ?? subjectWebURLsById.get(notificationId) ?? null;
      const subjectType = notification.subject?.type;
      if (subjectType === undefined) {
        throw new Error("GitHub notification missing subject type.");
      }
      const subjectTitle = notification.subject?.title;
      if (subjectTitle === undefined) {
        throw new Error(`GitHub notification ${notificationId} missing subject title.`);
      }
      const repositoryHTMLURL = notification.repository?.html_url;
      if (!repositoryHTMLURL) {
        throw new Error(`GitHub notification ${notificationId} missing repository link.`);
      }
      const repositoryURL = requireGitHubRepositoryRootURL(
        repositoryHTMLURL,
        `GitHub notification ${notificationId} repository`,
        repositoryFullName,
      );
      const webURL = requireGitHubWebURL(
        subjectURL,
        `GitHub notification ${String(notification.id)}`,
        { allowFragment: true },
      );
      const reason = notification.reason;
      if (reason === undefined) {
        throw new Error(`GitHub notification ${notificationId} missing reason.`);
      }
      if (typeof notification.unread !== "boolean") {
        throw new Error(`GitHub notification ${notificationId} missing unread state.`);
      }
      const updatedAt = parseGitHubDate(notification.updated_at);
      if (!updatedAt) {
        throw new Error(`GitHub notification ${notificationId} must include a valid updated_at timestamp.`);
      }

      return {
        id: notificationId,
        repositoryFullName,
        repositoryURL,
        subjectTitle,
        subjectType,
        subjectState: details?.state ?? null,
        subjectMerged: details?.merged ?? null,
        subjectAuthorLogin: details?.author ?? null,
        reason,
        updatedAt,
        isUnread: notification.unread,
        webURL,
      };
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function listSecurityAlertNotificationRepositories(): Promise<string[]> {
  const { notifications } = await fetchNotifications({
    maxResults: Number.MAX_SAFE_INTEGER,
    includeRead: true,
  });
  const repoSet = new Set(
    notifications
      .filter(
        (item) =>
          item.subject?.type === "RepositoryDependabotAlertsThread" ||
          item.reason === "security_alert",
      )
      .map((item) =>
        requireNotificationRepositoryFullName(item, validateNotificationThreadID(String(item.id))),
      ),
  );

  return [...repoSet].sort();
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const threadId = validateNotificationThreadID(notificationId);
  const token = resolveToken();
  if (!token) {
    throw new Error(
      `GitHub token not configured. Required permissions: ${githubPermissionText}`,
    );
  }
  const res = await ghFetchWithErrorContext(
    `https://${GITHUB_API_HOST}/notifications/threads/${threadId}`,
    token,
    `Could not mark GitHub notification ${threadId} as read`,
    { method: "PATCH" },
  );

  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status}: ${await githubErrorMessage(res)}`);
  }
}

import {
  isPositiveSafeIntegerValue,
} from "./github-url.ts";
import {
  hasCanonicalTextValue,
  inlineErrorText,
  isRecord,
  recordField,
  stringField,
} from "../text.ts";

export { hasCanonicalTextValue, inlineErrorText, isRecord, recordField, stringField };
import type {
  GitHubNotificationApi,
  NotificationRepository,
  NotificationSubject,
  PullRequestSummaryResponse,
  WorkflowRunResponse,
} from "./github-types.ts";

export function isNotificationSubject(value: unknown): value is NotificationSubject {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.type === undefined || hasCanonicalTextValue(value.type)) &&
    (value.title === undefined || hasCanonicalTextValue(value.title)) &&
    (value.url === undefined || value.url === null || hasCanonicalTextValue(value.url))
  );
}

export function isNotificationRepository(value: unknown): value is NotificationRepository {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.full_name === undefined || hasCanonicalTextValue(value.full_name)) &&
    (value.html_url === undefined || hasCanonicalTextValue(value.html_url))
  );
}

export function isWorkflowRunResponse(value: unknown): value is WorkflowRunResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveSafeIntegerValue(value.id) &&
    hasCanonicalTextValue(value.name) &&
    hasCanonicalTextValue(value.display_title) &&
    (value.head_branch === undefined || value.head_branch === null || hasCanonicalTextValue(value.head_branch)) &&
    hasCanonicalTextValue(value.status) &&
    hasCanonicalTextValue(value.conclusion) &&
    hasCanonicalTextValue(value.html_url) &&
    (value.created_at === undefined || hasCanonicalTextValue(value.created_at)) &&
    hasCanonicalTextValue(value.updated_at)
  );
}

export function isPullRequestState(value: unknown): value is "open" | "closed" {
  return value === "open" || value === "closed";
}

export function isDependabotAlertResponse(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveSafeIntegerValue(value.number) &&
    hasCanonicalTextValue(value.state) &&
    typeof value.html_url === "string" &&
    (value.security_advisory === undefined || isRecord(value.security_advisory)) &&
    (value.dependency === undefined || isRecord(value.dependency)) &&
    (value.security_vulnerability === undefined || isRecord(value.security_vulnerability))
  );
}

export function isPullRequestSummaryResponse(value: unknown): value is PullRequestSummaryResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPullRequestState(value.state) &&
    isRecord(value.head) &&
    hasCanonicalTextValue(value.head.ref)
  );
}

export function isPullRequestDetailsResponse(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPullRequestState(value.state) &&
    typeof value.merged === "boolean" &&
    (value.state === "closed" || value.merged === false) &&
    (value.user === undefined ||
      value.user === null ||
      (isRecord(value.user) && hasCanonicalTextValue(value.user.login)))
  );
}

export function isCommitResponse(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.author === undefined ||
      value.author === null ||
      (isRecord(value.author) &&
        (value.author.login === undefined || hasCanonicalTextValue(value.author.login)))) &&
    (value.commit === undefined ||
      (isRecord(value.commit) &&
        (value.commit.author === undefined ||
          value.commit.author === null ||
          (isRecord(value.commit.author) &&
            (value.commit.author.name === undefined || hasCanonicalTextValue(value.commit.author.name)) &&
            (value.commit.author.email === undefined || hasCanonicalTextValue(value.commit.author.email))))))
  );
}

export function isNotificationResponse(value: unknown): value is GitHubNotificationApi {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (isPositiveSafeIntegerValue(value.id) || hasCanonicalTextValue(value.id)) &&
    (value.repository === undefined || isNotificationRepository(value.repository)) &&
    (value.subject === undefined || isNotificationSubject(value.subject)) &&
    (value.reason === undefined || hasCanonicalTextValue(value.reason)) &&
    (value.updated_at === undefined || hasCanonicalTextValue(value.updated_at)) &&
    (value.unread === undefined || typeof value.unread === "boolean")
  );
}

export function hasPullRequestSubjectURL(
  notification: GitHubNotificationApi,
): notification is GitHubNotificationApi & { subject: NotificationSubject & { url: string } } {
  return notification.subject?.type === "PullRequest" && typeof notification.subject.url === "string";
}

export function numberField(record: Record<string, unknown> | null, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

export function hasPresentNonStringField(
  record: Record<string, unknown> | null,
  key: string,
): boolean {
  if (!record || !(key in record)) {
    return false;
  }

  const value = record[key];
  return value !== undefined && typeof value !== "string";
}

export function hasPresentNonRecordField(
  record: Record<string, unknown> | null,
  key: string,
): boolean {
  if (!record || !(key in record)) {
    return false;
  }

  const value = record[key];
  return value !== undefined && !isRecord(value);
}

export async function parseGitHubJSON(response: Response, responseName: string): Promise<unknown> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new Error(`${responseName} must be valid JSON.`);
  }
}

export async function githubErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return "GitHub API error response body was empty.";
  }

  try {
    const body: unknown = JSON.parse(text);
    if (!isRecord(body)) {
      return "GitHub API error response must be a JSON object.";
    }

    const message = stringField(body, "message");
    if (message === undefined) {
      return "GitHub API error response must include a message string.";
    }
    const trimmedMessage = message.trim();
    return trimmedMessage.length > 0
      ? inlineErrorText(trimmedMessage)
      : "GitHub API error response message was empty.";
  } catch {
    return inlineErrorText(text);
  }
}

import type {
  GitHubNotificationApi,
} from "./github-types.ts";
import {
  isPositiveIntegerText,
  rawGitHubPathSegments,
  validateNotificationThreadID,
  validateRepositoryFullName,
  validatedGitHubAPIURL,
} from "./github-url.ts";

export function requireNotificationRepositoryFullName(
  notification: GitHubNotificationApi,
  notificationId: string,
): string {
  const repositoryFullName = notification.repository?.full_name;
  if (!repositoryFullName) {
    throw new Error(`GitHub notification ${notificationId} missing repository name.`);
  }

  return validateRepositoryFullName(repositoryFullName);
}

export function parseSubjectURL(notification: GitHubNotificationApi): string | null {
  const subject = notification.subject;
  if (!subject) {
    return null;
  }

  const subjectType = subject.type;

  if (subjectType === "RepositoryDependabotAlertsThread") {
    const notificationId = validateNotificationThreadID(String(notification.id));
    return `https://github.com/${requireNotificationRepositoryFullName(notification, notificationId)}/security/dependabot`;
  }

  if (subjectType === undefined) {
    throw new Error("GitHub notification missing subject type.");
  }

  if (!subject.url) {
    return null;
  }

  if (subjectType === "Release") {
    return null;
  }

  const url = validatedGitHubAPIURL(subject.url);
  if (url.search) {
    throw new Error("GitHub notification subject URL must not include query strings.");
  }
  if (subjectType === undefined) {
    throw new Error("GitHub notification missing subject type.");
  }

  const parts = rawGitHubPathSegments(subject.url);
  if (parts === null || parts.length !== 5 || parts[0] !== "repos") {
    throw new Error(`GitHub notification subject URL is not a GitHub ${subjectType.toLowerCase()} API URL.`);
  }

  const owner = parts[1];
  const repo = parts[2];
  const kind = parts[3];
  const id = parts[4];
  const repositoryFullName = validateRepositoryFullName(`${owner}/${repo}`);
  const notificationRepositoryFullName = notification.repository?.full_name
    ? validateRepositoryFullName(notification.repository.full_name)
    : null;

  if (
    notificationRepositoryFullName &&
    repositoryFullName.toLowerCase() !== notificationRepositoryFullName.toLowerCase()
  ) {
    throw new Error("GitHub notification subject URL must stay in the notification repository.");
  }

  if (subjectType === "Issue") {
    if (kind === "issues" && isPositiveIntegerText(id)) {
      return `https://github.com/${repositoryFullName}/issues/${id}`;
    }

    throw new Error("GitHub notification subject URL is not a GitHub issue API URL.");
  }

  if (subjectType === "PullRequest") {
    if (kind === "pulls" && isPositiveIntegerText(id)) {
      return `https://github.com/${repositoryFullName}/pull/${id}`;
    }

    throw new Error("GitHub notification subject URL is not a GitHub pull request API URL.");
  }

  if (subjectType === "Commit") {
    if (kind === "commits" && /^[A-Fa-f0-9]{40}$/.test(id ?? "")) {
      return `https://github.com/${repositoryFullName}/commit/${id}`;
    }

    throw new Error("GitHub notification subject URL is not a GitHub commit API URL.");
  }

  return null;
}

export function parseSubjectDetailAPIURL(
  notification: GitHubNotificationApi,
  expectedRepositoryFullName: string,
): string | null {
  const subject = notification.subject;
  if (!subject) {
    return null;
  }

  const subjectType = subject.type;
  if (subjectType === "RepositoryDependabotAlertsThread") {
    return null;
  }

  const subjectURL = subject.url;
  if (!subjectURL) {
    return null;
  }

  const url = validatedGitHubAPIURL(subjectURL);
  if (url.search) {
    throw new Error("GitHub notification subject URL must not include query strings.");
  }

  const parts = rawGitHubPathSegments(subjectURL);
  if (subjectType === "Release") {
    const isReleasePath =
      parts !== null &&
      parts.length === 5 &&
      parts[0] === "repos" &&
      parts[3] === "releases" &&
      isPositiveIntegerText(parts[4]);
    if (!isReleasePath) {
      throw new Error("GitHub notification subject URL is not a GitHub release API URL.");
    }

    const repositoryFullName = validateRepositoryFullName(`${parts[1]}/${parts[2]}`);
    if (repositoryFullName.toLowerCase() !== expectedRepositoryFullName.toLowerCase()) {
      throw new Error("GitHub notification subject URL must stay in the notification repository.");
    }

    return url.href;
  }

  const isRepositoryAPIPath =
    parts !== null &&
    parts.length >= 3 &&
    parts[0] === "repos";
  if (!isRepositoryAPIPath) {
    throw new Error("GitHub notification subject URL is not a GitHub API URL in the notification repository.");
  }

  const repositoryFullName = validateRepositoryFullName(`${parts[1]}/${parts[2]}`);
  if (repositoryFullName.toLowerCase() !== expectedRepositoryFullName.toLowerCase()) {
    throw new Error("GitHub notification subject URL must stay in the notification repository.");
  }

  return url.href;
}

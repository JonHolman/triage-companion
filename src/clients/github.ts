import fs from "node:fs";
import path from "node:path";

import * as creds from "../credential-store.ts";
import { ENV } from "../config.ts";
import {
  getServiceDefinition,
  getServiceSetting,
  parseJSONStringArray,
  validateGitHubIgnoredBranchNames,
  validateRegularExpression,
} from "../config-model.ts";
import { trimEnvValue } from "../config-path.ts";
import {
  findGitRepositories,
  isGitRepositoryMetadataPath,
  normalizeRepositorySearchRoots,
  resolveRepositorySearchRoots,
} from "../git/search.ts";
import { normalizedKnownSeverity, severityRank } from "../severity.ts";
import {
  requireGitBinary,
  runGitCommand,
} from "../git/executor.ts";

const tokenField = getServiceSetting("github", "token");
const SERVICE = tokenField.storage?.service ?? "Triage Companion-GitHub";
const ACCOUNT = tokenField.storage?.account ?? "notifications-token";
const API_VERSION = "2022-11-28";
const USER_AGENT = "triage-companion";
const GITHUB_API_HOST = "api.github.com";
const DEFAULT_IGNORED_PR_BRANCHES = new Set(["main", "master", "production"]);
const githubPermissionText = getServiceDefinition("github").status.permissionRequirements
  .map((requirement) => `${requirement.feature}: ${requirement.permissions.join(", ")}`)
  .join("; ");

interface NotificationSubject {
  type?: string;
  title?: string;
  url?: string;
}

interface NotificationRepository {
  full_name?: string;
  html_url?: string;
}

interface GitHubNotificationApi {
  id: string | number;
  repository?: NotificationRepository;
  subject?: NotificationSubject;
  reason?: string;
  updated_at?: string;
  unread?: boolean;
}

interface GitHubNotification {
  id: string;
  repositoryFullName: string;
  repositoryURL: string;
  subjectTitle: string;
  subjectType: string;
  subjectState: string | null;
  subjectMerged: boolean | null;
  subjectAuthorLogin: string | null;
  reason: string;
  updatedAt: Date | null;
  isUnread: boolean;
  webURL: string;
}

interface PrDetails {
  state: string | null;
  merged: boolean | null;
  author: string | null;
}

interface PullRequestSummary {
  state: string | null;
  headRef: string;
}

interface OpenPullRequest {
  repositoryPath: string;
  repositoryName: string;
  branch: string;
  pullRequestNumber: number;
  url: string;
  author: string;
  headSHA: string;
}

interface OpenPullRequestOptions {
  repositoryPaths?: string[];
  searchRoots?: string[];
  authorRegex?: string | null;
  githubLogin?: string | null;
}

interface DependabotAlert {
  repositoryFullName: string;
  ghsaID: string;
  packageName: string;
  severity: string;
  state: string;
  vulnerableRange: string | null;
  patchedVersion: string | null;
  manifestPath: string | null;
  url: string;
  summary: string;
}

interface FailedWorkflowRun {
  repositoryFullName: string;
  workflowName: string;
  title: string;
  branch: string | null;
  status: string;
  conclusion: string;
  url: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface WorkflowRunResponse extends Record<string, unknown> {
  id: number;
  name: string;
  display_title: string;
  head_branch?: string;
  status: string;
  conclusion: string;
  html_url: string;
  created_at?: string;
  updated_at: string;
}

interface PullRequestSummaryResponse extends Record<string, unknown> {
  state: string;
  head: {
    ref: string;
  };
}

interface GitHubRef {
  sha: string;
  ref: string;
}

interface GhFetchOptions {
  method?: "GET" | "PATCH";
}

function resolveToken(): string | null {
  const token = creds.readCredential(SERVICE, ACCOUNT, tokenField.envVar ?? ENV.GITHUB_TOKEN);
  return token !== null ? validateConfiguredText(token, "GitHub token") : null;
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

function validatedGitHubAPIURL(value: string): URL {
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

function isPositiveIntegerText(value: string | undefined): boolean {
  return Boolean(value && /^[1-9]\d*$/.test(value));
}

function parsePositiveSafeIntegerText(value: string | undefined): number | null {
  if (value === undefined || !isPositiveIntegerText(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isPositiveSafeIntegerValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isGitObjectIDText(value: string | undefined): boolean {
  return Boolean(value && /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(value));
}

function validatePositiveIntegerOption(
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

function validatePullRequestAPIURL(
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
  const pathEnd =
    pathEndCandidates.length > 0 ? Math.min(...pathEndCandidates) : pathAndSuffix.length;
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

function rawGitHubPathSegments(value: string): string[] | null {
  const segments = decodedRawURLPathSegments(value);
  if (segments === null || segments.some((part) => part === "." || part === "..")) {
    return null;
  }

  return segments;
}

function validateNotificationThreadID(value: string): string {
  if (!isPositiveIntegerText(value)) {
    throw new Error("GitHub notification thread ID must be a positive number.");
  }

  return value;
}

function stableGitHubPaginationQuery(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.delete("page");
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

function recordGitHubPaginationURL(seen: Set<string>, next: string, context: string): void {
  const nextKey = gitHubPaginationLoopKey(next);
  if (seen.has(nextKey)) {
    throw new Error(`${context} repeated a previously fetched page.`);
  }

  seen.add(nextKey);
}

export function hasToken(): boolean {
  try {
    return resolveToken() !== null;
  } catch {
    return false;
  }
}

export function saveToken(token: string): void {
  const validated = validateConfiguredText(token, "GitHub token");
  creds.save(SERVICE, ACCOUNT, validated);
}

export function removeToken(): void {
  creds.remove(SERVICE, ACCOUNT);
}

async function ghFetch(
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

async function ghFetchWithErrorContext(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNotificationSubject(value: unknown): value is NotificationSubject {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.type === undefined || hasCanonicalTextValue(value.type)) &&
    (value.title === undefined || hasCanonicalTextValue(value.title)) &&
    (value.url === undefined || hasCanonicalTextValue(value.url))
  );
}

function isNotificationRepository(value: unknown): value is NotificationRepository {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.full_name === undefined || hasCanonicalTextValue(value.full_name)) &&
    (value.html_url === undefined || hasCanonicalTextValue(value.html_url))
  );
}

function isWorkflowRunResponse(value: unknown): value is WorkflowRunResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveSafeIntegerValue(value.id) &&
    hasCanonicalTextValue(value.name) &&
    hasCanonicalTextValue(value.display_title) &&
    (value.head_branch === undefined ||
      hasCanonicalTextValue(value.head_branch)) &&
    hasCanonicalTextValue(value.status) &&
    hasCanonicalTextValue(value.conclusion) &&
    hasCanonicalTextValue(value.html_url) &&
    (value.created_at === undefined ||
      hasCanonicalTextValue(value.created_at)) &&
    hasCanonicalTextValue(value.updated_at)
  );
}

function hasCanonicalTextValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim() === value &&
    !/[\u0000-\u001F\u007F-\u009F]/.test(value)
  );
}

function isPullRequestState(value: unknown): value is "open" | "closed" {
  return value === "open" || value === "closed";
}

function isDependabotAlertResponse(value: unknown): value is Record<string, unknown> {
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

function isPullRequestSummaryResponse(value: unknown): value is PullRequestSummaryResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPullRequestState(value.state) &&
    isRecord(value.head) &&
    hasCanonicalTextValue(value.head.ref)
  );
}

function isPullRequestDetailsResponse(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPullRequestState(value.state) &&
    typeof value.merged === "boolean" &&
    (value.state === "closed" || value.merged === false) &&
    (value.user === undefined ||
      (isRecord(value.user) &&
        hasCanonicalTextValue(value.user.login)))
  );
}

function isCommitResponse(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.author === undefined ||
      (isRecord(value.author) &&
        (value.author.login === undefined || hasCanonicalTextValue(value.author.login)))) &&
    (value.commit === undefined ||
      (isRecord(value.commit) &&
        (value.commit.author === undefined ||
          (isRecord(value.commit.author) &&
            (value.commit.author.name === undefined || hasCanonicalTextValue(value.commit.author.name)) &&
            (value.commit.author.email === undefined || hasCanonicalTextValue(value.commit.author.email))))))
  );
}

function isNotificationResponse(value: unknown): value is GitHubNotificationApi {
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

function hasPullRequestSubjectURL(
  notification: GitHubNotificationApi,
): notification is GitHubNotificationApi & { subject: NotificationSubject & { url: string } } {
  return notification.subject?.type === "PullRequest" && typeof notification.subject.url === "string";
}

function recordField(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const value = record?.[key];
  return isRecord(value) ? value : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown> | null, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function hasPresentNonStringField(
  record: Record<string, unknown> | null,
  key: string,
): boolean {
  if (!record || !(key in record)) {
    return false;
  }

  const value = record[key];
  return value !== undefined && typeof value !== "string";
}

function hasPresentNonRecordField(
  record: Record<string, unknown> | null,
  key: string,
): boolean {
  if (!record || !(key in record)) {
    return false;
  }

  const value = record[key];
  return value !== undefined && !isRecord(value);
}

async function parseGitHubJSON(response: Response, responseName: string): Promise<unknown> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new Error(`${responseName} must be valid JSON.`);
  }
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

function requireNotificationRepositoryFullName(
  notification: GitHubNotificationApi,
  notificationId: string,
): string {
  const repositoryFullName = notification.repository?.full_name;
  if (!repositoryFullName) {
    throw new Error(`GitHub notification ${notificationId} missing repository name.`);
  }

  return validateRepositoryFullName(repositoryFullName);
}

function parseSubjectURL(notification: GitHubNotificationApi): string | null {
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

function parseSubjectDetailAPIURL(
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

function remoteRepositoryURL(remoteURL: string): string | null {
  const value = remoteURL.replace(/[\r\n]+$/, "");
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    return null;
  }
  const lowerValue = value.toLowerCase();

  if (lowerValue.startsWith("git@github.com:")) {
    const repositoryFullName = repositoryFullNameFromPath(
      stripGitSuffix(value.slice("git@github.com:".length)),
    );
    return repositoryFullName ? `https://github.com/${repositoryFullName}` : null;
  }
  if (lowerValue.startsWith("ssh://git@github.com/")) {
    const repositoryFullName = repositoryFullNameFromPath(
      stripGitSuffix(value.slice("ssh://git@github.com/".length)),
    );
    return repositoryFullName ? `https://github.com/${repositoryFullName}` : null;
  }
  if (lowerValue.startsWith("ssh://git@github.com:")) {
    const repositoryFullName = repositoryFullNameFromRemoteURL(value, "ssh:");
    return repositoryFullName ? `https://github.com/${repositoryFullName}` : null;
  }
  if (lowerValue.startsWith("https://")) {
    const repositoryFullName = repositoryFullNameFromRemoteURL(value, "https:");
    return repositoryFullName ? `https://github.com/${repositoryFullName}` : null;
  }
  return null;
}

function validateRepositoryPath(repositoryPath: string): void {
  if (/[\u0000-\u001F\u007F-\u009F]/.test(repositoryPath)) {
    throw new Error("Git repository path must not include control characters.");
  }
}

function isGitHubRemoteCandidate(value: string): boolean {
  const lowerValue = value.toLowerCase();
  if (
    lowerValue.startsWith("git@github.com:") ||
    lowerValue.startsWith("ssh://git@github.com/") ||
    lowerValue.startsWith("ssh://git@github.com:") ||
    lowerValue.startsWith("https://")
  ) {
    try {
      return new URL(stripGitSuffix(value)).hostname === "github.com";
    } catch {
      return (
        lowerValue.startsWith("git@github.com:") ||
        lowerValue.startsWith("ssh://git@github.com/") ||
        lowerValue.startsWith("ssh://git@github.com:")
      );
    }
  }

  return false;
}

function invalidGitHubRemoteConfigurationMessage(remoteURL: string): string | null {
  const value = remoteURL.replace(/[\r\n]+$/, "");
  if (value.trim().length === 0) {
    return "Git remote origin URL must not be empty.";
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    return "Git remote origin URL must not include control characters.";
  }
  if (value.trim() !== value && isGitHubRemoteCandidate(value.trim())) {
    return "Git remote origin URL must not include surrounding whitespace.";
  }
  const lowerValue = value.toLowerCase();
  if (lowerValue.startsWith("git@github.com:")) {
    return remoteRepositoryURL(value)
      ? null
      : "Git remote origin is not a valid GitHub repository URL.";
  }

  try {
    const url = new URL(stripGitSuffix(value));
    if (url.hostname !== "github.com") {
      return null;
    }

    return remoteRepositoryURL(value)
      ? null
      : "Git remote origin is not a valid GitHub repository URL.";
  } catch {
    return null;
  }
}

function repositoryFullNameFromRemoteURL(value: string, protocol: string): string | null {
  try {
    const url = new URL(stripGitSuffix(value));
    const hasAllowedPort =
      !url.port ||
      (protocol === "ssh:" && url.port === "22");

    if (
      url.protocol !== protocol ||
      url.hostname !== "github.com" ||
      (protocol === "https:" && (url.username || url.password)) ||
      !hasAllowedPort ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    const repositoryFullName = repositoryFullNameFromURL(stripGitSuffix(value));
    return repositoryFullName;
  } catch {
    return null;
  }
}

function repositoryFullNameFromPath(value: string): string | null {
  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    parts[0]?.length === 0 ||
    parts[1]?.length === 0
  ) {
    return null;
  }

  try {
    return validateRepositoryFullName(`${parts[0]}/${parts[1]}`);
  } catch {
    return null;
  }
}

function stripGitSuffix(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  return normalized.endsWith(".git") ? normalized.slice(0, -4) : normalized;
}

function remoteRefs(output: string): GitHubRef[] {
  return output
    .split("\n")
    .map((line) => line.replace(/[\r\n]+$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.trim() !== line) {
        throw new Error("Git remote ref output must not include surrounding whitespace.");
      }

      const parts = line.split("\t");
      if (parts.length !== 2) {
        throw new Error("Git remote ref output lines must contain an object ID and ref separated by a tab.");
      }

      const sha = parts[0] ?? "";
      const ref = parts[1] ?? "";
      if (!isGitObjectIDText(sha)) {
        throw new Error("Git remote ref output must include full object IDs.");
      }
      if (!hasCanonicalTextValue(ref) || !ref.startsWith("refs/")) {
        throw new Error("Git remote ref output must include a valid ref name.");
      }

      return { sha, ref };
    });
}

function branchName(ref: string): string {
  if (!ref.startsWith("refs/heads/")) {
    throw new Error("Git remote branch refs must match refs/heads/<branch>.");
  }

  const branch = ref.slice("refs/heads/".length);
  if (!hasCanonicalTextValue(branch)) {
    throw new Error("Git remote branch refs must match refs/heads/<branch>.");
  }

  return branch;
}

function pullRequestNumber(ref: string, suffix: string): number | null {
  if (!ref.startsWith("refs/pull/") || !ref.endsWith(suffix)) {
    return null;
  }

  const numberText = ref.slice("refs/pull/".length, -suffix.length);
  return parsePositiveSafeIntegerText(numberText);
}

function validatePullRequestRef(ref: string): void {
  if (!/^refs\/pull\/[1-9]\d*\/(?:head|merge)$/.test(ref)) {
    throw new Error("Git remote pull request refs must match refs/pull/<positive-number>/(head|merge).");
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function defaultAuthorPattern(
  gitBinary: string,
  githubLogin: string | null,
  repositoryPath: string,
): RegExp | null {
  const patterns: string[] = [];
  for (const key of ["user.name", "user.email"]) {
    try {
      const rawValue = runGitCommand(gitBinary, ["-C", repositoryPath, "config", "--get", key]);
      const value = rawValue.replace(/[\r\n]+$/, "");
      if (!hasCanonicalTextValue(value)) {
        throw new Error(`Git config ${key} in ${repositoryPath} must include a valid value.`);
      }

      patterns.push(`(?:^|\\s)${escapeRegex(value)}(?:$|\\s)`);
    } catch (error) {
      if (!isMissingGitConfigValueError(error)) {
        throw error;
      }

      continue;
    }
  }

  if (githubLogin) {
    const escapedLogin = escapeRegex(githubLogin);
    patterns.push(`(?:^|\\s)${escapedLogin}(?:$|\\s)`);
    patterns.push(`(?:^|\\s)(?:\\d+\\+)?${escapedLogin}@users\\.noreply\\.github\\.com(?:$|\\s)`);
  }

  if (patterns.length === 0) {
    return null;
  }

  return new RegExp(patterns.join("|"), "i");
}

function buildAuthorPattern(raw: string | null): RegExp | null {
  if (raw === null) {
    return null;
  }
  if (raw.length === 0) {
    throw new Error("GitHub PR author regex must not be empty.");
  }

  const validation = validateRegularExpression(raw);
  if (validation) {
    throw new Error(`GitHub PR author regex ${validation}.`);
  }

  return new RegExp(raw, "i");
}

function inlineErrorText(text: string): string {
  const normalizedLineBreaks = text.replace(/\r\n?|\n/g, ", ");
  return normalizedLineBreaks.replace(/[\u0000-\u001F\u007F-\u009F]/g, (character) => {
    switch (character) {
      case "\t":
        return "\\t";
      default:
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    }
  });
}

async function githubErrorMessage(response: Response): Promise<string> {
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
    return hasCanonicalTextValue(message)
      ? message
      : "GitHub API error response message must be non-empty text without surrounding whitespace or control characters.";
  } catch {
    return inlineErrorText(text);
  }
}

function repositoryFullNameFromURL(repositoryURL: string): string | null {
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

function parseGitHubDate(value: string | undefined): Date | null {
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

function requireGitHubWebURL(value: string | null, context: string): string {
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

function requireGitHubRepositoryWebURL(
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

function requireGitHubRepositoryLinkURL(
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

function requireGitHubRepositoryRootURL(
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

function requireDependabotAlertWebURL(
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

function requireWorkflowRunWebURL(
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

function gitCommandErrorText(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string") {
      return stderr;
    }
    if (stderr instanceof Uint8Array) {
      return Buffer.from(stderr).toString("utf-8");
    }
  }

  return error instanceof Error ? error.message : String(error);
}

function isMissingRepositoryContextError(error: unknown): boolean {
  const message = gitCommandErrorText(error);
  return /not a git repository/i.test(message) || /no such remote ['"]?origin['"]?/i.test(message);
}

function isMissingLocalGitObjectError(error: unknown): boolean {
  const message = gitCommandErrorText(error);
  return /not a valid object name/i.test(message) ||
    /could not get object info/i.test(message) ||
    /bad object/i.test(message) ||
    /unknown revision or path not in the working tree/i.test(message);
}

function isMissingGitConfigValueError(error: unknown): boolean {
  return gitCommandErrorText(error).replace(/[\r\n]+$/, "") === "";
}

function validateRepositoryFullName(value: string): string {
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

async function loadPullRequestSummary(
  repositoryURL: string,
  pullRequestNumberValue: number,
  token: string | null,
): Promise<PullRequestSummary | null> {
  const repositoryFullName = repositoryFullNameFromURL(repositoryURL);
  if (!repositoryFullName) {
    return null;
  }
  if (!Number.isSafeInteger(pullRequestNumberValue) || pullRequestNumberValue <= 0) {
    return null;
  }

  const response = await ghFetchWithErrorContext(
    `https://${GITHUB_API_HOST}/repos/${repositoryFullName}/pulls/${pullRequestNumberValue}`,
    token,
    `Could not look up GitHub pull request #${pullRequestNumberValue} in ${repositoryFullName}`,
  );

  if (!response.ok) {
    throw new Error(
      `GitHub API HTTP ${response.status} while checking pull request #${pullRequestNumberValue} in ${repositoryFullName}: ${await githubErrorMessage(response)}`,
    );
  }

  const body = await parseGitHubJSON(response, "GitHub pull request response");
  if (!isRecord(body)) {
    throw new Error("GitHub pull request response must be an object.");
  }
  if (!isPullRequestSummaryResponse(body)) {
    throw new Error("GitHub pull request response must be an object with valid top-level fields.");
  }

  return {
    state: body.state,
    headRef: body.head.ref,
  };
}

async function commitAuthorFromGitHub(
  repositoryURL: string,
  sha: string,
  token: string | null,
): Promise<string | null> {
  const repositoryFullName = repositoryFullNameFromURL(repositoryURL);
  if (!repositoryFullName) {
    return null;
  }

  const response = await ghFetchWithErrorContext(
    `https://${GITHUB_API_HOST}/repos/${repositoryFullName}/commits/${sha}`,
    token,
    `Could not load GitHub commit ${sha} in ${repositoryFullName}`,
  );

  if (!response.ok) {
    throw new Error(
      `GitHub API HTTP ${response.status} while loading commit ${sha} in ${repositoryFullName}: ${await githubErrorMessage(response)}`,
    );
  }

  const body = await parseGitHubJSON(response, "GitHub commit response");
  if (!isRecord(body)) {
    throw new Error("GitHub commit response must be an object.");
  }
  if (!isCommitResponse(body)) {
    throw new Error("GitHub commit response must be an object with valid top-level fields.");
  }

  const commit = recordField(body, "commit");
  const commitAuthor = recordField(commit, "author");
  const author = recordField(body, "author");
  const values = [
    stringField(commitAuthor, "name"),
    stringField(commitAuthor, "email"),
    stringField(author, "login"),
  ].filter((value): value is string => value !== undefined);
  if (values.length === 0) {
    throw new Error(`GitHub commit ${sha} in ${repositoryFullName} missing author identity.`);
  }

  return values.join(" ");
}

function configuredIgnoredBranches(): Set<string> {
  if (trimEnvValue(process.env[ENV.GITHUB_PR_IGNORE_BRANCHES]) === null) {
    return DEFAULT_IGNORED_PR_BRANCHES;
  }

  const raw = parseJSONStringArray(
    process.env[ENV.GITHUB_PR_IGNORE_BRANCHES],
    "GitHub ignored branch list",
  );
  const validation = validateGitHubIgnoredBranchNames(raw);
  if (validation !== null) {
    throw new Error(`GitHub ignored branch list ${validation}.`);
  }

  return new Set(raw);
}

function validateExplicitRepositoryPaths(repositoryPaths: readonly string[]): string[] {
  const uniquePaths: string[] = [];
  const seen = new Set<string>();

  for (const [index, repositoryPath] of repositoryPaths.entries()) {
    const pathLabel = `Repository path #${index + 1}`;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(repositoryPath);
    } catch {
      throw new Error(`${pathLabel} does not exist.`);
    }

    if (!stat.isDirectory()) {
      throw new Error(`${pathLabel} is not a directory.`);
    }

    if (!isGitRepositoryMetadataPath(path.join(repositoryPath, ".git"))) {
      throw new Error(`${pathLabel} is not a Git repository.`);
    }

    const key = (() => {
      try {
        return fs.realpathSync(repositoryPath);
      } catch {
        return path.resolve(repositoryPath);
      }
    })();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniquePaths.push(repositoryPath);
  }

  return uniquePaths;
}

function uniqueRepositoryFullNames(repositoryFullNames: readonly string[]): string[] {
  const uniqueNames: string[] = [];
  const seen = new Set<string>();

  for (const repositoryName of repositoryFullNames) {
    const validated = validateRepositoryFullName(repositoryName);
    const key = validated.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueNames.push(validated);
  }

  return uniqueNames;
}

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

  let url = `https://${GITHUB_API_HOST}/notifications?${params}`;
  const raw: GitHubNotificationApi[] = [];
  const seen = new Set<string>([gitHubPaginationLoopKey(url)]);

  while (raw.length < limit) {
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
          `SSO authorization required. Visit: ${urlMatch?.[1] || "(check GitHub settings)"}`,
        );
      }
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

    raw.push(...notificationPage);

    if (raw.length >= limit) {
      break;
    }

    const rawNext = nextURL(res.headers.get("link"));
    const next = rawNext ? validateGitHubPaginationURL(rawNext, url) : null;
    if (!next) {
      break;
    }
    if (notificationPage.length === 0) {
      throw new Error("GitHub notifications response returned an empty page before pagination finished.");
    }

    recordGitHubPaginationURL(seen, next, "GitHub notifications pagination");
    url = next;
  }

  return { token, notifications: raw.slice(0, limit) };
}

export async function listNotifications({
  maxResults = 200,
  includeRead = false,
}: {
  maxResults?: number;
  includeRead?: boolean;
} = {}): Promise<GitHubNotification[]> {
  const { token, notifications: limited } = await fetchNotifications({ maxResults, includeRead });
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

  const detailsById = new Map<string, PrDetails>();
  const BATCH = 8;
  for (let i = 0; i < pullRequestRefs.length; i += BATCH) {
    const batch = pullRequestRefs.slice(i, i + BATCH);
    const resolved = await Promise.allSettled(
      batch.map(async ({ id, apiURL, repositoryFullName }) => {
        const expectedRepositoryFullName = validateRepositoryFullName(
          repositoryFullName,
        );
        const response = await ghFetchWithErrorContext(
          validatePullRequestAPIURL(apiURL, expectedRepositoryFullName),
          token,
          `Could not fetch notification pull request ${id}`,
        );
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
          state: body.state as string,
          merged: body.merged as boolean,
          author: stringField(user, "login") ?? null,
        };
      }),
    );

    for (const entry of resolved) {
      if (entry.status === "rejected") {
        throw entry.reason instanceof Error ? entry.reason : new Error(String(entry.reason));
      }

      if (entry.status === "fulfilled" && entry.value) {
        detailsById.set(entry.value.id, {
          state: entry.value.state,
          merged: entry.value.merged,
          author: entry.value.author,
        });
      }
    }
  }

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

  const subjectWebURLsById = new Map<string, string>();
  for (let i = 0; i < subjectDetailRefs.length; i += BATCH) {
    const batch = subjectDetailRefs.slice(i, i + BATCH);
    const resolved = await Promise.allSettled(
      batch.map(async ({ id, apiURL, repositoryFullName }) => {
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
          webURL: requireGitHubRepositoryLinkURL(
            htmlURL,
            `GitHub notification ${id} subject`,
            repositoryFullName,
          ),
        };
      }),
    );

    for (const entry of resolved) {
      if (entry.status === "rejected") {
        throw entry.reason instanceof Error ? entry.reason : new Error(inlineErrorText(String(entry.reason)));
      }

      if (entry.value) {
        subjectWebURLsById.set(entry.value.id, entry.value.webURL);
      }
    }
  }

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
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
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

export async function listMyOpenPullRequests({
  repositoryPaths,
  searchRoots,
  authorRegex = null,
  githubLogin = null,
}: OpenPullRequestOptions = {}): Promise<OpenPullRequest[]> {
  const explicitAuthorPattern = buildAuthorPattern(authorRegex);
  const validatedGitHubLogin = githubLogin === null
    ? null
    : validateConfiguredText(githubLogin, "GitHub login");
  const hasExplicitRepositoryPaths = repositoryPaths !== undefined;
  const hasExplicitSearchRoots = searchRoots !== undefined;
  const normalizedSearchRoots = hasExplicitSearchRoots
    ? normalizeRepositorySearchRoots(searchRoots)
    : [];
  const repos = hasExplicitRepositoryPaths
    ? validateExplicitRepositoryPaths(repositoryPaths)
    : findGitRepositories(
      hasExplicitSearchRoots ? normalizedSearchRoots : resolveRepositorySearchRoots(),
    );
  if (repos.length === 0) {
    return [];
  }

  const gitBinary = requireGitBinary();
  let resolvedToken: string | null | undefined;

  const ignoredBranches = configuredIgnoredBranches();
  let resolvedLogin = validatedGitHubLogin;
  let hasResolvedLogin = validatedGitHubLogin !== null;
  let resolvedLoginError: Error | null = null;

  const resolveTokenIfNeeded = (): string | null => {
    if (resolvedToken === undefined) {
      resolvedToken = resolveToken();
    }

    return resolvedToken;
  };

  const resolveLoginIfNeeded = async (): Promise<string | null> => {
    if (authorRegex || hasResolvedLogin) {
      return resolvedLogin;
    }

    hasResolvedLogin = true;
    try {
      resolvedLogin = await resolveAuthenticatedLogin();
    } catch (error) {
      resolvedLoginError = error instanceof Error ? error : new Error(String(error));
      resolvedLogin = null;
    }

    return resolvedLogin;
  };

  const items: OpenPullRequest[] = [];
  let missingAuthorIdentity = false;

  for (const repositoryPath of repos) {
    validateRepositoryPath(repositoryPath);
    let remoteURL: string | null;
    try {
      const rawRemoteURL = runGitCommand(gitBinary, ["-C", repositoryPath, "remote", "get-url", "origin"]);
      remoteURL = remoteRepositoryURL(rawRemoteURL);
      if (!remoteURL) {
        const invalidRemoteMessage = invalidGitHubRemoteConfigurationMessage(rawRemoteURL);
        if (invalidRemoteMessage) {
          throw new Error(invalidRemoteMessage);
        }
      }
    } catch (error) {
      if (isMissingRepositoryContextError(error)) {
        continue;
      }

      throw error;
    }

    if (!remoteURL) {
      continue;
    }

    let branchRefs: GitHubRef[];
    let pullRefs: GitHubRef[];
    branchRefs = remoteRefs(
      runGitCommand(gitBinary, [
        "-C",
        repositoryPath,
        "ls-remote",
        "origin",
        "refs/heads/*",
      ]),
    );
    for (const ref of branchRefs) {
      branchName(ref.ref);
    }
    pullRefs = remoteRefs(
      runGitCommand(gitBinary, [
        "-C",
        repositoryPath,
        "ls-remote",
        "origin",
        "refs/pull/*/head",
        "refs/pull/*/merge",
      ]),
    );
    for (const ref of pullRefs) {
      validatePullRequestRef(ref.ref);
    }

    if (pullRefs.length === 0) {
      continue;
    }

    const openPullRequestNumbers = new Set(
      pullRefs
        .map((ref) => pullRequestNumber(ref.ref, "/merge"))
        .filter((id): id is number => id !== null),
    );

    const headRefsBySHA = new Map<string, GitHubRef[]>();
    for (const ref of pullRefs.filter((ref) => ref.ref.endsWith("/head"))) {
      const entries = headRefsBySHA.get(ref.sha) ?? [];
      entries.push(ref);
      headRefsBySHA.set(ref.sha, entries);
    }

    const branchRefsBySHA = new Map<string, GitHubRef[]>();
    for (const ref of branchRefs) {
      const entries = branchRefsBySHA.get(ref.sha) ?? [];
      entries.push(ref);
      branchRefsBySHA.set(ref.sha, entries);
    }

    const repositoryFullName = repositoryFullNameFromURL(remoteURL);
    if (!repositoryFullName) {
      continue;
    }
    const pullRequestSummaryPromises = new Map<number, Promise<PullRequestSummary | null>>();
    const loadPullRequestSummaryIfNeeded = (
      pullRequestNumberValue: number,
    ): Promise<PullRequestSummary | null> => {
      const existing = pullRequestSummaryPromises.get(pullRequestNumberValue);
      if (existing) {
        return existing;
      }

      const pending = loadPullRequestSummary(
        remoteURL,
        pullRequestNumberValue,
        resolveTokenIfNeeded(),
      );
      pullRequestSummaryPromises.set(pullRequestNumberValue, pending);
      return pending;
    };

    let authorPattern = explicitAuthorPattern;
    for (const branchRef of branchRefs) {
      const branch = branchName(branchRef.ref);
      if (ignoredBranches.has(branch)) {
        continue;
      }

      const matchingHead = headRefsBySHA.get(branchRef.sha);
      if (!matchingHead?.length) {
        continue;
      }

      const candidatePullRequestNumbers = [...new Set(
        matchingHead
          .map((item) => pullRequestNumber(item.ref, "/head"))
          .filter((id): id is number => id !== null),
      )];

      if (candidatePullRequestNumbers.length === 0) {
        continue;
      }

      const sharedBranchRefs = branchRefsBySHA.get(branchRef.sha) ?? [];
      const isAmbiguousBranchSHA = sharedBranchRefs.length > 1;
      const requiresHeadRefDisambiguation =
        isAmbiguousBranchSHA || candidatePullRequestNumbers.length > 1;
      const matchingPullRequestNumbers: number[] = [];

      for (const candidatePullRequestNumber of candidatePullRequestNumbers) {
        if (requiresHeadRefDisambiguation) {
          const summary = await loadPullRequestSummaryIfNeeded(candidatePullRequestNumber);
          if (summary?.state !== "open") {
            continue;
          }

          if (summary.headRef !== branch) {
            continue;
          }

          matchingPullRequestNumbers.push(candidatePullRequestNumber);
          continue;
        }

        if (openPullRequestNumbers.has(candidatePullRequestNumber)) {
          matchingPullRequestNumbers.push(candidatePullRequestNumber);
          continue;
        }

        const summary = await loadPullRequestSummaryIfNeeded(candidatePullRequestNumber);
        if (summary?.state === "open") {
          matchingPullRequestNumbers.push(candidatePullRequestNumber);
        }
      }

      if (matchingPullRequestNumbers.length === 0) {
        continue;
      }

      if (authorPattern === null) {
        authorPattern = defaultAuthorPattern(gitBinary, validatedGitHubLogin, repositoryPath);
      }
      if (!authorPattern) {
        const githubLoginForPattern = await resolveLoginIfNeeded();
        authorPattern = githubLoginForPattern
          ? defaultAuthorPattern(gitBinary, githubLoginForPattern, repositoryPath)
          : null;
      }
      if (!authorPattern) {
        missingAuthorIdentity = true;
        break;
      }

      let localObjectMissing = false;
      try {
        runGitCommand(gitBinary, ["-C", repositoryPath, "cat-file", "-e", branchRef.sha]);
      } catch (error) {
        if (!isMissingLocalGitObjectError(error)) {
          throw error;
        }

        localObjectMissing = true;
      }

      const author = localObjectMissing
        ? await commitAuthorFromGitHub(
          remoteURL,
          branchRef.sha,
          resolveTokenIfNeeded(),
        )
        : runGitCommand(gitBinary, [
          "-C",
          repositoryPath,
          "log",
          "-1",
          "--format=%an %ae",
          branchRef.sha,
        ]).replace(/[\r\n]+$/, "");

      if (!hasCanonicalTextValue(author)) {
        throw new Error(`Git commit ${branchRef.sha} in ${repositoryFullName} must include a valid author identity.`);
      }

      if (!authorPattern.test(author)) {
        continue;
      }

      for (const matchingPullRequestNumber of matchingPullRequestNumbers) {
        items.push({
          repositoryPath,
          repositoryName: path.basename(repositoryPath),
          branch,
          pullRequestNumber: matchingPullRequestNumber,
          url: `${remoteURL}/pull/${matchingPullRequestNumber}`,
          author,
          headSHA: branchRef.sha,
        });
      }
    }
  }

  if (missingAuthorIdentity) {
    if (resolvedLoginError) {
      throw resolvedLoginError;
    }

    throw new Error(
      "Could not determine your git author identity. Set GITHUB_TOKEN so your GitHub login can be inferred, configure git user.name/user.email, or pass --github-login <login> / --author-regex <pattern>.",
    );
  }

  return items.sort((left, right) => {
    if (left.repositoryName !== right.repositoryName) {
      return left.repositoryName.localeCompare(right.repositoryName);
    }

    return left.branch.localeCompare(right.branch);
  });
}

export async function listSecurityAlerts(
  repositoryFullNames: string[],
  { maxPerRepo = Number.POSITIVE_INFINITY }: { maxPerRepo?: number } = {},
): Promise<DependabotAlert[]> {
  const validatedRepositoryNames = uniqueRepositoryFullNames(repositoryFullNames);
  if (validatedRepositoryNames.length === 0) {
    return [];
  }

  const token = resolveToken();
  if (!token) {
    throw new Error(`GitHub token not configured. Required permissions: ${githubPermissionText}`);
  }

  const alerts: DependabotAlert[] = [];
  const BATCH = 6;
  const limit = validatePositiveIntegerOption(maxPerRepo, "GitHub Dependabot alert limit", {
    allowInfinity: true,
  });

  for (let i = 0; i < validatedRepositoryNames.length; i += BATCH) {
    const batch = validatedRepositoryNames.slice(i, i + BATCH);

    const results = await Promise.allSettled(
      batch.map(async (encodedRepositoryName) => {
        const perPage = Math.min(limit, 100);
        const repoAlerts: DependabotAlert[] = [];
        let url = `https://${GITHUB_API_HOST}/repos/${encodedRepositoryName}/dependabot/alerts?state=open&per_page=${perPage}`;
        const seen = new Set<string>([gitHubPaginationLoopKey(url)]);

        while (repoAlerts.length < limit) {
          const response = await ghFetchWithErrorContext(
            url,
            token,
            `Could not fetch GitHub Dependabot alerts for ${encodedRepositoryName}`,
          );

          if (!response.ok) {
            const message = await githubErrorMessage(response);
            throw new Error(`GitHub API HTTP ${response.status} for ${encodedRepositoryName}: ${message}`);
          }

          const payload = await parseGitHubJSON(
            response,
            `GitHub Dependabot alerts response for ${encodedRepositoryName}`,
          );
          if (!Array.isArray(payload)) {
            throw new Error(`GitHub Dependabot alerts response for ${encodedRepositoryName} must be an array.`);
          }
          const alertRecords = payload.filter(isRecord);
          if (alertRecords.length !== payload.length) {
            throw new Error(`GitHub Dependabot alerts response for ${encodedRepositoryName} must contain objects.`);
          }
          const alertPage = alertRecords.filter(isDependabotAlertResponse);
          if (alertPage.length !== alertRecords.length) {
            throw new Error(
              `GitHub Dependabot alerts response for ${encodedRepositoryName} must contain alert objects with valid top-level fields.`,
            );
          }

          repoAlerts.push(
            ...alertPage.map((alert) => {
              const advisory = recordField(alert, "security_advisory");
              const dependency = recordField(alert, "dependency");
              if (hasPresentNonRecordField(dependency, "package")) {
                throw new Error(
                  `Dependabot alert ${alert.number} for ${encodedRepositoryName} dependency package must be an object.`,
                );
              }
              const dependencyPackage = recordField(dependency, "package");
              const vulnerability = recordField(alert, "security_vulnerability");
              if (hasPresentNonRecordField(vulnerability, "package")) {
                throw new Error(
                  `Dependabot alert ${alert.number} for ${encodedRepositoryName} vulnerability package must be an object.`,
                );
              }
              const vulnerabilityPackage = recordField(vulnerability, "package");
              if (hasPresentNonRecordField(vulnerability, "first_patched_version")) {
                throw new Error(
                  `Dependabot alert ${alert.number} for ${encodedRepositoryName} first patched version must be an object.`,
                );
              }
              const patchedVersion = recordField(vulnerability, "first_patched_version");
              const alertNumber = numberField(alert, "number");
              const htmlURL = stringField(alert, "html_url");
              if (htmlURL !== undefined && !hasCanonicalTextValue(htmlURL)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} html_url must not include surrounding whitespace.`,
                );
              }
              const url = requireDependabotAlertWebURL(
                htmlURL ?? null,
                `Dependabot alert for ${encodedRepositoryName}`,
                encodedRepositoryName,
                alertNumber,
              );
              if (
                hasPresentNonStringField(dependencyPackage, "name") ||
                hasPresentNonStringField(vulnerabilityPackage, "name")
              ) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} package name must be a string.`,
                );
              }
              const dependencyPackageName = stringField(dependencyPackage, "name");
              if (dependencyPackageName !== undefined && !hasCanonicalTextValue(dependencyPackageName)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} package name must not include surrounding whitespace.`,
                );
              }
              const vulnerabilityPackageName = stringField(vulnerabilityPackage, "name");
              if (vulnerabilityPackageName !== undefined && !hasCanonicalTextValue(vulnerabilityPackageName)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} package name must not include surrounding whitespace.`,
                );
              }
              const packageName = dependencyPackageName ?? vulnerabilityPackageName;
              if (!packageName) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} missing package name.`,
                );
              }
              if (
                hasPresentNonStringField(vulnerability, "severity") ||
                hasPresentNonStringField(advisory, "severity")
              ) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} severity must be a string.`,
                );
              }
              const vulnerabilitySeverity = stringField(vulnerability, "severity");
              if (vulnerabilitySeverity !== undefined && !hasCanonicalTextValue(vulnerabilitySeverity)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} severity must not include surrounding whitespace.`,
                );
              }
              const advisorySeverity = stringField(advisory, "severity");
              if (advisorySeverity !== undefined && !hasCanonicalTextValue(advisorySeverity)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} severity must not include surrounding whitespace.`,
                );
              }
              const severity = vulnerabilitySeverity ?? advisorySeverity;
              if (!severity) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} missing severity.`,
                );
              }
              if (!normalizedKnownSeverity(severity)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} severity must be one of critical, high, medium, or low.`,
                );
              }
              const ghsaID = stringField(advisory, "ghsa_id");
              if (!ghsaID) {
                if (hasPresentNonStringField(advisory, "ghsa_id")) {
                  throw new Error(
                    `Dependabot alert ${alertNumber} for ${encodedRepositoryName} GHSA id must be a string.`,
                  );
                }
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} missing GHSA id.`,
                );
              }
              if (!hasCanonicalTextValue(ghsaID)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} GHSA id must not include surrounding whitespace.`,
                );
              }
              const summary = stringField(advisory, "summary");
              if (!summary) {
                if (hasPresentNonStringField(advisory, "summary")) {
                  throw new Error(
                    `Dependabot alert ${alertNumber} for ${encodedRepositoryName} summary must be a string.`,
                  );
                }
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} missing summary.`,
                );
              }
              if (!hasCanonicalTextValue(summary)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} summary must not include surrounding whitespace.`,
                );
              }
              if (alert.state !== "open") {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} must have state open.`,
                );
              }
              const vulnerableRange = stringField(vulnerability, "vulnerable_version_range");
              if (vulnerableRange === undefined && hasPresentNonStringField(vulnerability, "vulnerable_version_range")) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} vulnerable version range must be a string.`,
                );
              }
              if (vulnerableRange !== undefined && !hasCanonicalTextValue(vulnerableRange)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} vulnerable version range must not include surrounding whitespace.`,
                );
              }
              const patchedVersionIdentifier = stringField(patchedVersion, "identifier");
              if (patchedVersionIdentifier === undefined && hasPresentNonStringField(patchedVersion, "identifier")) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} patched version must be a string.`,
                );
              }
              if (patchedVersionIdentifier !== undefined && !hasCanonicalTextValue(patchedVersionIdentifier)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} patched version must not include surrounding whitespace.`,
                );
              }
              const manifestPath = stringField(dependency, "manifest_path");
              if (manifestPath === undefined && hasPresentNonStringField(dependency, "manifest_path")) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} manifest path must be a string.`,
                );
              }
              if (manifestPath !== undefined && !hasCanonicalTextValue(manifestPath)) {
                throw new Error(
                  `Dependabot alert ${alertNumber} for ${encodedRepositoryName} manifest path must not include surrounding whitespace.`,
                );
              }

              return {
                repositoryFullName: encodedRepositoryName,
                ghsaID,
                packageName,
                severity,
                state: alert.state,
                vulnerableRange: vulnerableRange ?? null,
                patchedVersion: patchedVersionIdentifier ?? null,
                manifestPath: manifestPath ?? null,
                url,
                summary,
              };
            }),
          );

          const rawNext = nextURL(response.headers.get("link"));
          const next = rawNext ? validateGitHubPaginationURL(rawNext, url) : null;
          if (!next) {
            break;
          }
          if (payload.length === 0) {
            throw new Error(`GitHub Dependabot alerts response for ${encodedRepositoryName} returned an empty page before pagination finished.`);
          }

          recordGitHubPaginationURL(
            seen,
            next,
            `GitHub Dependabot alerts pagination for ${encodedRepositoryName}`,
          );
          url = next;
        }

        return repoAlerts.slice(0, limit);
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        alerts.push(...result.value);
      } else {
        const message = result.reason instanceof Error
          ? result.reason.message
          : inlineErrorText(String(result.reason));
        throw new Error(`Could not list Dependabot security alerts: ${message}`);
      }
    }
  }

  return alerts.sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      left.ghsaID.localeCompare(right.ghsaID) ||
      left.repositoryFullName.localeCompare(right.repositoryFullName),
  );
}

export function resolveCurrentRepositoryFullName(repositoryPath: string = process.cwd()): string | null {
  validateRepositoryPath(repositoryPath);
  const gitBinary = requireGitBinary();

  try {
    const rawRemoteURL = runGitCommand(gitBinary, ["-C", repositoryPath, "remote", "get-url", "origin"]);
    const remoteURL = remoteRepositoryURL(rawRemoteURL);
    if (!remoteURL) {
      const invalidRemoteMessage = invalidGitHubRemoteConfigurationMessage(rawRemoteURL);
      if (invalidRemoteMessage) {
        throw new Error(invalidRemoteMessage);
      }
    }

    return remoteURL ? repositoryFullNameFromURL(remoteURL) : null;
  } catch (error) {
    if (isMissingRepositoryContextError(error)) {
      return null;
    }

    throw error;
  }
}

export async function listFailedWorkflowRuns(
  repositoryFullNames: string[],
  { maxPerRepo = 5 }: { maxPerRepo?: number } = {},
): Promise<FailedWorkflowRun[]> {
  const validatedRepositoryNames = uniqueRepositoryFullNames(repositoryFullNames);
  if (validatedRepositoryNames.length === 0) {
    return [];
  }

  const limit = validatePositiveIntegerOption(maxPerRepo, "GitHub failed workflow limit");
  const token = resolveToken();
  if (!token) {
    throw new Error(`GitHub token not configured. Required permissions: ${githubPermissionText}`);
  }

  const runs: FailedWorkflowRun[] = [];

  for (const encodedRepositoryName of validatedRepositoryNames) {
    const perPage = Math.min(limit, 100);
    let url = `https://${GITHUB_API_HOST}/repos/${encodedRepositoryName}/actions/runs?status=failure&per_page=${perPage}`;
    const seen = new Set<string>([gitHubPaginationLoopKey(url)]);
    const repoRuns: FailedWorkflowRun[] = [];

    while (repoRuns.length < limit) {
      const response = await ghFetchWithErrorContext(
        url,
        token,
        `Could not fetch GitHub workflow runs for ${encodedRepositoryName}`,
      );
      if (!response.ok) {
        const message = await githubErrorMessage(response);
        throw new Error(`GitHub API HTTP ${response.status} for ${encodedRepositoryName}: ${message}`);
      }

      const payload = await parseGitHubJSON(
        response,
        `GitHub workflow runs response for ${encodedRepositoryName}`,
      );
      const workflowRunData = isRecord(payload) ? payload.workflow_runs : undefined;
      if (!isRecord(payload) || !Array.isArray(workflowRunData)) {
        throw new Error(`GitHub workflow runs response for ${encodedRepositoryName} must include a workflow_runs array.`);
      }
      const workflowRunRecords = workflowRunData.filter(isRecord);
      if (workflowRunRecords.length !== workflowRunData.length) {
        throw new Error(`GitHub workflow runs response for ${encodedRepositoryName} must contain workflow run objects.`);
      }
      const workflowRuns = workflowRunRecords.filter(
        (run): run is WorkflowRunResponse => isWorkflowRunResponse(run),
      );
      if (workflowRuns.length !== workflowRunRecords.length) {
        throw new Error(`GitHub workflow runs response for ${encodedRepositoryName} must contain workflow run objects with valid top-level fields.`);
      }

      repoRuns.push(
        ...workflowRuns.map((run) => {
            if (run.conclusion !== "failure") {
              throw new Error(
                `GitHub workflow run for ${encodedRepositoryName} must have conclusion failure.`,
              );
            }
            if (run.status !== "completed") {
              throw new Error(
                `GitHub workflow run for ${encodedRepositoryName} must have status completed.`,
              );
            }
            const createdAtText = stringField(run, "created_at");
            const createdAt = parseGitHubDate(createdAtText);
            if (createdAtText && !createdAt) {
              throw new Error(
                `GitHub workflow run for ${encodedRepositoryName} must include a valid created_at timestamp.`,
              );
            }
            const updatedAt = parseGitHubDate(stringField(run, "updated_at"));
            if (!updatedAt) {
              throw new Error(
                `GitHub workflow run for ${encodedRepositoryName} must include a valid updated_at timestamp.`,
              );
            }

            return {
              repositoryFullName: encodedRepositoryName,
              workflowName: run.name,
              title: run.display_title,
              branch: stringField(run, "head_branch") ?? null,
              status: run.status,
              conclusion: "failure",
              url: requireWorkflowRunWebURL(
                stringField(run, "html_url") ?? null,
                `GitHub Actions workflow run for ${encodedRepositoryName}`,
                encodedRepositoryName,
                numberField(run, "id"),
              ),
              createdAt,
              updatedAt,
            };
          }),
      );

      if (repoRuns.length >= limit) {
        break;
      }

      const rawNext = nextURL(response.headers.get("link"));
      const next = rawNext ? validateGitHubPaginationURL(rawNext, url) : null;
      if (!next) {
        break;
      }
      if (workflowRunData.length === 0) {
        throw new Error(`GitHub workflow runs response for ${encodedRepositoryName} returned an empty page before pagination finished.`);
      }

      recordGitHubPaginationURL(
        seen,
        next,
        `GitHub workflow runs pagination for ${encodedRepositoryName}`,
      );
      url = next;
    }

    runs.push(...repoRuns.slice(0, limit));
  }

  return runs.sort(
    (left, right) =>
      (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0) ||
      left.repositoryFullName.localeCompare(right.repositoryFullName) ||
      left.workflowName.localeCompare(right.workflowName),
  );
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export type ServiceId = "github" | "snyk" | "jira" | "git" | "local";

export const DEFAULT_SEARCH_ROOTS = [
  "Projects",
  "repos",
  "workspace",
  "work",
  "code",
  "src",
] as const;

export const DEFAULT_SNYK_API_BASE_URL = "https://api.snyk.io/rest";
export const US_SNYK_API_BASE_URLS = [
  DEFAULT_SNYK_API_BASE_URL,
  "https://api.us.snyk.io/rest",
] as const;

const GIT_VERSION_CHECK_TIMEOUT_MS = 5000;

export const ENV = {
  CONFIG_DIR: "TRIAGE_COMPANION_CONFIG_DIR",
  GIT_BINARY: "TRIAGE_COMPANION_GIT",
  GIT_SEARCH_ROOTS: "TRIAGE_COMPANION_GIT_SEARCH_ROOTS",
  GITHUB_TOKEN: "GITHUB_TOKEN",
  GITHUB_PR_AUTHOR_REGEX: "TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX",
  GITHUB_PR_IGNORE_BRANCHES: "TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES",
  SNYK_ORGANIZATION_IDS: "TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS",
  SNYK_API_BASE_URL: "TRIAGE_COMPANION_SNYK_API_BASE_URL",
  SNYK_TOKEN: "SNYK_TOKEN",
  JIRA_BASE_URL: "JIRA_BASE_URL",
  JIRA_EMAIL: "JIRA_EMAIL",
  JIRA_API_TOKEN: "JIRA_API_TOKEN",
} as const;

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

function gitSearchRootsList(value: string): string | null {
  if (value.trim().length === 0) {
    return "must be a JSON array of non-empty strings";
  }
  if (value.trim().length > 0 && value.trim() !== value) {
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

function gitHubIgnoredBranchList(value: string): string | null {
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

export function validateGitHubIgnoredBranchNames(branches: readonly string[]): string | null {
  if (branches.some((branch) => /[\u0000-\u001F\u007F-\u009F]/.test(branch))) {
    return "must contain branch names without control characters";
  }

  return branches.every((branch) => branch.trim() === branch)
    ? null
    : "must contain branch names without surrounding whitespace";
}

interface StorageBinding {
  service: string;
  account: string;
}

export interface ConfigFieldModel {
  key: string;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  persisted: boolean;
  environmentOverridesStored?: boolean;
  ignoreBlankEnvironmentValue?: boolean;
  envVar?: string;
  storage?: StorageBinding;
  defaultValues?: string[];
  validate?: (value: string) => string | null;
}

interface ServiceStatusMetadata {
  permissionRequirements: readonly TokenPermissionRequirement[];
  saveHint: string;
  envHint: string;
  configuredLabel: string;
  missingLabel: string;
  setupGuidance: readonly string[];
}

export interface TokenPermissionRequirement {
  feature: string;
  permissions: readonly string[];
}

export interface ServiceModel {
  id: ServiceId;
  name: string;
  command: string;
  status: ServiceStatusMetadata;
  requiredSettings: readonly ConfigFieldModel[];
  optionalSettings: readonly ConfigFieldModel[];
}

export interface ResolvedFieldState {
  value: string | null;
  source: "secret" | "environment" | "default" | "missing";
}

export interface ServiceResolution {
  configured: boolean;
  values: Record<string, ResolvedFieldState>;
  errors: string[];
}

interface ResolutionContext {
  readEnv: (name: string) => string | undefined;
  readSecret: (service: string, account: string) => string | null;
}

function nonEmpty(value: string): string | null {
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

function safeCommaSeparatedAPIPathSegments(value: string): string | null {
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

function expandHomeRelativePath(candidate: string): string {
  if (candidate === "~") {
    return validatedHomeDirectory();
  }

  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    const homeDirectory = validatedHomeDirectory();
    return path.join(homeDirectory, candidate.slice(2));
  }

  return candidate;
}

function validatedHomeDirectory(): string {
  const homeDirectory = os.homedir();
  if (homeDirectory.trim().length === 0) {
    throw new Error("Home directory is invalid: must not be empty.");
  }
  if (homeDirectory.trim() !== homeDirectory) {
    throw new Error("Home directory is invalid: must not include surrounding whitespace.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(homeDirectory)) {
    throw new Error("Home directory is invalid: must not include control characters.");
  }

  return homeDirectory;
}

function executablePath(value: string): string | null {
  let expanded: string;
  try {
    expanded = expandHomeRelativePath(value);
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

export function hasUnsafeURLPathSegments(value: string): boolean {
  const schemeIndex = value.indexOf("://");
  const pathAndSuffix =
    schemeIndex === -1
      ? (() => {
          const pathStart = value.indexOf("/");
          return pathStart === -1 ? "/" : value.slice(pathStart);
        })()
      : (() => {
          const pathStart = value.indexOf("/", schemeIndex + 3);
          return pathStart === -1 ? "/" : value.slice(pathStart);
        })();
  const searchIndex = pathAndSuffix.indexOf("?");
  const hashIndex = pathAndSuffix.indexOf("#");
  const pathEndCandidates = [searchIndex, hashIndex].filter((index) => index >= 0);
  const pathEnd =
    pathEndCandidates.length > 0 ? Math.min(...pathEndCandidates) : pathAndSuffix.length;
  const rawPath = pathAndSuffix.slice(0, pathEnd);

  try {
    const parts = rawPath.split("/");
    if (parts[0] !== "") {
      return true;
    }

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

function usSnykAPIBaseURL(value: string): string | null {
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

function jiraHTTPSBaseURL(value: string): string | null {
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

const SERVICES: Record<ServiceId, ServiceModel> = {
  github: {
    id: "github",
    name: "GitHub",
    command: "github",
    status: {
      permissionRequirements: [
        {
          feature: "GitHub notifications",
          permissions: [
            "Classic personal access token with the notifications scope; fine-grained personal access tokens are not supported by GitHub notification endpoints",
          ],
        },
        {
          feature: "github mark-read",
          permissions: [
            "Classic personal access token with the notifications scope; fine-grained personal access tokens are not supported by GitHub notification endpoints",
          ],
        },
        {
          feature: "github security-alerts",
          permissions: [
            "Fine-grained token with Dependabot alerts: read; classic token with security_events for public repos or repo for private repos",
          ],
        },
        {
          feature: "github failed-workflows",
          permissions: ["Actions: read for fine-grained tokens; repo for private repositories with classic tokens"],
        },
        {
          feature: "github my-open-prs",
          permissions: [
            "No token required for local git discovery; a GitHub token is used when local git identity is unavailable and to read PR or commit metadata that local git cannot provide",
          ],
        },
      ],
      saveHint: "triage-companion github token <token>",
      envHint: "GITHUB_TOKEN",
      configuredLabel: "configured",
      missingLabel: "not configured",
      setupGuidance: [
        "Create a token in GitHub Settings > Developer settings > Personal access tokens.",
        "If your org uses SSO, authorize the token for the org before using it here.",
        "If USA-only residency is required, use a GitHub account or enterprise configuration that satisfies that requirement.",
      ],
    },
    requiredSettings: [
      {
        key: "token",
        label: "GitHub token",
        description: "Token for GitHub API calls",
        required: true,
        secret: true,
        persisted: true,
        envVar: ENV.GITHUB_TOKEN,
        storage: {
          service: "Triage Companion-GitHub",
          account: "notifications-token",
        },
        validate: nonEmpty,
      },
    ],
    optionalSettings: [
      {
        key: "authorRegex",
        label: "PR author regex",
        description: "Regex matching your git author identity",
        required: false,
        secret: false,
        persisted: false,
        envVar: ENV.GITHUB_PR_AUTHOR_REGEX,
        ignoreBlankEnvironmentValue: true,
        validate: validateRegularExpression,
      },
      {
        key: "ignoredBranches",
        label: "Ignored PR branches",
        description: "JSON array of branch names excluded from PR discovery",
        required: false,
        secret: false,
        persisted: false,
        envVar: ENV.GITHUB_PR_IGNORE_BRANCHES,
        ignoreBlankEnvironmentValue: true,
        validate: gitHubIgnoredBranchList,
        defaultValues: ["main", "master", "production"],
      },
    ],
  },
  snyk: {
    id: "snyk",
    name: "Snyk",
    command: "snyk",
    status: {
      permissionRequirements: [
        {
          feature: "Snyk issues",
          permissions: [
            "Token with read access to Organizations and Projects",
            "Read-only API scope for issue listings",
          ],
        },
      ],
      saveHint: "triage-companion snyk token <token>",
      envHint: "SNYK_TOKEN",
      configuredLabel: "configured",
      missingLabel: "not configured",
      setupGuidance: [
        "Copy an API token from your Snyk account or organization settings page.",
        "Use a read-only token that can list organizations, projects, and issues.",
        "Use a US-hosted Snyk REST API base URL: https://api.snyk.io/rest or https://api.us.snyk.io/rest.",
        "Do not include usernames, tokens, or other credentials in the Snyk REST API base URL.",
        "Snyk issue links must point to the US app hosts app.snyk.io or app.us.snyk.io.",
        "Endpoint selection only controls where this CLI sends requests; confirm Snyk contractual and tenant data residency requirements before saving credentials.",
        "Snyk Gov is US-hosted, but this token-based client does not support it because Snyk Gov requires OAuth instead of static API tokens.",
      ],
    },
    requiredSettings: [
      {
        key: "token",
        label: "Snyk API token",
        description: "Token for Snyk REST API calls",
        required: true,
        secret: true,
        persisted: true,
        envVar: ENV.SNYK_TOKEN,
        storage: {
          service: "Triage Companion-Snyk",
          account: "token",
        },
        validate: nonEmpty,
      },
    ],
    optionalSettings: [
      {
        key: "apiBaseURL",
        label: "API base URL",
        description: "Snyk REST API base URL",
        required: false,
        secret: false,
        persisted: true,
        envVar: ENV.SNYK_API_BASE_URL,
        storage: {
          service: "Triage Companion-Config",
          account: "snyk-api-base-url",
        },
        defaultValues: [DEFAULT_SNYK_API_BASE_URL],
        validate: usSnykAPIBaseURL,
      },
      {
        key: "organizationIds",
        label: "Organization IDs",
        description: "Comma-separated Snyk organization IDs to include",
        required: false,
        secret: false,
        persisted: false,
        envVar: ENV.SNYK_ORGANIZATION_IDS,
        ignoreBlankEnvironmentValue: true,
        validate: safeCommaSeparatedAPIPathSegments,
      },
    ],
  },
  jira: {
    id: "jira",
    name: "Jira",
    command: "jira",
    status: {
      permissionRequirements: [
        {
          feature: "Jira tickets",
          permissions: ["Browse Projects", "View Issues"],
        },
      ],
      saveHint: "triage-companion jira credentials <base-url> <email> <token>",
      envHint: "JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN",
      configuredLabel: "configured",
      missingLabel: "not configured",
      setupGuidance: [
        "Use the Jira site root from your browser address bar, for example https://your-company.atlassian.net.",
        "If you are viewing a ticket page, remove the trailing /browse/... path and keep only the site root.",
        "Do not include usernames, tokens, or other credentials in the Jira base URL.",
        "If USA-only residency is required, confirm the Atlassian site data residency policy with your site admin.",
      ],
    },
    requiredSettings: [
      {
        key: "baseURL",
        label: "Base URL",
        description: "Jira base URL",
        required: true,
        secret: false,
        persisted: true,
        envVar: ENV.JIRA_BASE_URL,
        storage: {
          service: "Triage Companion-Jira",
          account: "base-url",
        },
        validate: jiraHTTPSBaseURL,
      },
      {
        key: "email",
        label: "Email",
        description: "Jira account email",
        required: true,
        secret: false,
        persisted: true,
        envVar: ENV.JIRA_EMAIL,
        storage: {
          service: "Triage Companion-Jira",
          account: "email",
        },
        validate: nonEmpty,
      },
      {
        key: "apiToken",
        label: "API token",
        description: "Jira API token",
        required: true,
        secret: true,
        persisted: true,
        environmentOverridesStored: true,
        envVar: ENV.JIRA_API_TOKEN,
        storage: {
          service: "Triage Companion-Jira",
          account: "api-token",
        },
        validate: nonEmpty,
      },
    ],
    optionalSettings: [],
  },
  git: {
    id: "git",
    name: "Git",
    command: "git",
    status: {
      permissionRequirements: [],
      saveHint: "Install git or set TRIAGE_COMPANION_GIT",
      envHint: "TRIAGE_COMPANION_GIT",
      configuredLabel: "available",
      missingLabel: "not available",
      setupGuidance: [
        "Install Git from your package manager or point TRIAGE_COMPANION_GIT at the git executable.",
      ],
    },
    requiredSettings: [],
    optionalSettings: [
      {
        key: "binary",
        label: "Git binary",
        description: "Path to git executable",
        required: false,
        secret: false,
        persisted: false,
        envVar: ENV.GIT_BINARY,
        ignoreBlankEnvironmentValue: true,
        validate: executablePath,
      },
    ],
  },
  local: {
    id: "local",
    name: "Local search settings",
      command: "status",
      status: {
        permissionRequirements: [],
        saveHint: "triage-companion config git-search-roots <paths-json>",
        envHint: "TRIAGE_COMPANION_GIT_SEARCH_ROOTS",
        configuredLabel: "configured",
        missingLabel: "not configured",
        setupGuidance: [
          "Use triage-companion config git-search-roots <paths-json> or point TRIAGE_COMPANION_GIT_SEARCH_ROOTS at a JSON array of the directories where your local repos live.",
        ],
      },
    requiredSettings: [],
    optionalSettings: [
      {
        key: "searchRoots",
        label: "Git search roots",
        description: "Root directories searched for local repositories",
        required: false,
        secret: false,
        persisted: true,
        envVar: ENV.GIT_SEARCH_ROOTS,
        ignoreBlankEnvironmentValue: true,
        storage: {
          service: "Triage Companion-Config",
          account: "git-search-roots",
        },
        defaultValues: [...DEFAULT_SEARCH_ROOTS],
        validate: gitSearchRootsList,
      },
      {
        key: "configDirectory",
        label: "Config directory",
        description: "Directory for credential storage",
        required: false,
        secret: false,
        persisted: false,
        envVar: ENV.CONFIG_DIR,
        ignoreBlankEnvironmentValue: true,
        validate: nonEmpty,
      },
    ],
  },
};

export function listServiceDefinitions(): ReadonlyArray<ServiceModel> {
  return [SERVICES.github, SERVICES.snyk, SERVICES.jira, SERVICES.git, SERVICES.local];
}

export function getServiceDefinition(id: ServiceId): ServiceModel {
  return SERVICES[id];
}

export function getServiceSetting(serviceId: ServiceId, fieldKey: string): ConfigFieldModel {
  const definition = SERVICES[serviceId];
  const settings = [...definition.requiredSettings, ...definition.optionalSettings];

  const setting = settings.find((item) => item.key === fieldKey);
  if (!setting) {
    throw new Error(`Missing configuration field ${fieldKey} for ${definition.name}`);
  }

  return setting;
}

function resolveValue(field: ConfigFieldModel, context: ResolutionContext): ResolvedFieldState {
  const envVar = field.envVar;
  const environmentOverridesStored = Boolean(envVar && (!field.secret || field.environmentOverridesStored));
  const readEnvValue = (): string | undefined => {
    if (!envVar) {
      return undefined;
    }

    const envValue = context.readEnv(envVar);
    if (!field.ignoreBlankEnvironmentValue) {
      return envValue;
    }

    return trim(envValue) === null ? undefined : envValue;
  };
  if (environmentOverridesStored && envVar) {
    const envValue = readEnvValue();
    if (envValue !== undefined) {
      return { value: envValue, source: "environment" };
    }
  }

  if (field.storage) {
    const stored = context.readSecret(field.storage.service, field.storage.account);
    if (stored !== null) {
      return { value: stored, source: "secret" };
    }
  }

  if (envVar && !environmentOverridesStored) {
    const envValue = readEnvValue();
    if (envValue !== undefined) {
      return { value: envValue, source: "environment" };
    }
  }

  if (field.defaultValues?.length) {
    return {
      value: field.defaultValues.join("\n"),
      source: "default",
    };
  }

  return { value: null, source: "missing" };
}

export function resolveServiceState(
  serviceId: ServiceId,
  context: ResolutionContext,
): ServiceResolution {
  const definition = SERVICES[serviceId];
  const values: Record<string, ResolvedFieldState> = {};
  const errors: string[] = [];

  const evaluate = (field: ConfigFieldModel): void => {
    const state = resolveValue(field, context);
    values[field.key] = state;

    if (field.required && state.value === null) {
      errors.push(`${field.label} is required for ${definition.name}.`);
      return;
    }

    if (state.value !== null && state.source !== "default" && field.validate) {
      const validation = field.validate(state.value);
      if (validation !== null) {
        errors.push(`${field.label} is invalid: ${validation}`);
      }
    }
  };

  for (const field of definition.requiredSettings) {
    evaluate(field);
  }

  for (const field of definition.optionalSettings) {
    evaluate(field);
  }

  return {
    configured: errors.length === 0,
    values,
    errors,
  };
}

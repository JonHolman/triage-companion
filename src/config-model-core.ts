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

export interface StorageBinding {
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

export interface TokenPermissionRequirement {
  feature: string;
  permissions: readonly string[];
}

export interface ServiceStatusMetadata {
  permissionRequirements: readonly TokenPermissionRequirement[];
  saveHint: string;
  envHint: string;
  configuredLabel: string;
  missingLabel: string;
  setupGuidance: readonly string[];
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

export interface ResolutionContext {
  readEnv: (name: string) => string | undefined;
  readSecret: (service: string, account: string) => string | null;
}

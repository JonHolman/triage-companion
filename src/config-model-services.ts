import {
  DEFAULT_SEARCH_ROOTS,
  DEFAULT_SNYK_API_BASE_URL,
  ENV,
  type ConfigFieldModel,
  type ServiceId,
  type ServiceModel,
} from "./config-model-core.ts";
import {
  executablePath,
  gitHubIgnoredBranchList,
  gitSearchRootsList,
  jiraHTTPSBaseURL,
  nonEmpty,
  safeCommaSeparatedAPIPathSegments,
  usSnykAPIBaseURL,
  validateRegularExpression,
} from "./config-model-validators.ts";

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
          permissions: [
            "Actions: read for fine-grained tokens; repo for private repositories with classic tokens",
          ],
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

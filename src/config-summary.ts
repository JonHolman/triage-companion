import { inlineErrorText as escapeControlCharacters } from "./text.ts";
import { configFilePath, read as readCredential } from "./credential-store.ts";
import {
  ENV,
  parseSearchRootsInput,
  readSearchRootsConfig,
  resolveSearchRoots,
} from "./config.ts";
import {
  type ConfigFieldModel,
  hasUnsafeURLPathSegments,
  listServiceDefinitions,
  normalizeSnykAPIBaseURL,
  parseJSONStringArray,
  type ServiceResolution,
  resolveServiceState,
  US_SNYK_API_BASE_URLS,
  validateGitHubIgnoredBranchNames,
} from "./config-model.ts";
import { trimEnvValue } from "./config-path.ts";

function errorMessage(error: unknown): string {
  return escapeControlCharacters(error instanceof Error ? error.message : String(error));
}

function describeResolvedValue(value: string | null, source: string, secret: boolean): string {
  if (!value) {
    return "not set";
  }

  if (secret) {
    return source === "environment" ? "configured (environment)" : "configured";
  }

  return escapeControlCharacters(value);
}

function shouldRedactInvalidBaseURL(
  serviceId: string,
  fieldKey: string,
  value: string,
): boolean {
  if (
    !(
      (serviceId === "jira" && fieldKey === "baseURL") ||
      (serviceId === "snyk" && fieldKey === "apiBaseURL")
    )
  ) {
    return false;
  }

  if (value.trim().length === 0) {
    return true;
  }

  const trimmed = value.trim();
  const candidate = serviceId === "jira" && !trimmed.includes("://")
    ? `https://${trimmed}`
    : trimmed;
  if (hasCredentialLikeAuthority(candidate)) {
    return true;
  }

  try {
    const parsed = new URL(candidate);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
}

function hasCredentialLikeAuthority(value: string): boolean {
  const schemeIndex = value.indexOf("://");
  const authorityStart = schemeIndex === -1 ? 0 : schemeIndex + 3;
  const authorityEndCandidates = ["/", "?", "#"]
    .map((separator) => value.indexOf(separator, authorityStart))
    .filter((index) => index >= 0);
  const authorityEnd = authorityEndCandidates.length > 0
    ? Math.min(...authorityEndCandidates)
    : value.length;
  const authority = value.slice(authorityStart, authorityEnd);
  const credentialEnd = authority.lastIndexOf("@");
  return credentialEnd > 0;
}

function canonicalBaseURLForSummary(serviceId: string, fieldKey: string, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed !== value) {
    return null;
  }
  if (serviceId === "snyk" && fieldKey === "apiBaseURL") {
    if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) {
      return null;
    }
    if (hasUnsafeURLPathSegments(trimmed)) {
      return null;
    }
    const normalized = normalizeSnykAPIBaseURL(trimmed);
    return (US_SNYK_API_BASE_URLS as readonly string[]).includes(normalized) ? normalized : null;
  }

  if (serviceId === "jira" && fieldKey === "baseURL") {
    if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) {
      return null;
    }
    if (hasUnsafeURLPathSegments(trimmed)) {
      return null;
    }
    const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withScheme);
      if (
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        parsed.pathname === "/" &&
        !parsed.search &&
        !parsed.hash
      ) {
        return parsed.origin;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function describeFieldValue(
  serviceId: string,
  fieldKey: string,
  value: string | null,
  source: string,
  secret: boolean,
): string {
  if (serviceId === "github" && fieldKey === "ignoredBranches" && value) {
    try {
      const branches = parseJSONStringArray(value, "GitHub ignored branch list");
      if (validateGitHubIgnoredBranchNames(branches) === null) {
        return branches.length > 0 ? branches.join(", ") : "(none)";
      }
    } catch {
      // Show invalid config exactly as set.
    }
  }

  if (value) {
    const canonicalBaseURL = canonicalBaseURLForSummary(serviceId, fieldKey, value);
    if (canonicalBaseURL !== null) {
      return canonicalBaseURL;
    }
  }

  return describeResolvedValue(value, source, secret);
}

function describeResolvedFieldValue(
  serviceId: string,
  field: ConfigFieldModel,
  value: string | null,
  source: string,
): string {
  if (source === "default" && field.defaultValues?.length) {
    return field.defaultValues.join(", ");
  }

  if (value !== null && field.validate && field.validate(value) !== null) {
    if (
      field.secret ||
      value.trim().length === 0 ||
      shouldRedactInvalidBaseURL(serviceId, field.key, value)
    ) {
      return source === "environment" ? "invalid (environment)" : "invalid";
    }
  }

  return describeFieldValue(serviceId, field.key, value, source, field.secret);
}

export function buildConfigurationSummary(): string {
  const lines: string[] = ["Configuration", ""];

  for (const service of listServiceDefinitions()) {
    if (service.id === "local") {
      continue;
    }

    const serviceLines: string[] = [`${service.name}`];

    let state: ServiceResolution;
    try {
      state = resolveServiceState(service.id, {
        readEnv: (name) => process.env[name],
        readSecret: (serviceName, account) => readCredential(serviceName, account),
      });
    } catch (error) {
      serviceLines.push(`  Configuration error: ${errorMessage(error)}`);
      lines.push(...serviceLines, "");
      continue;
    }

    for (const field of service.requiredSettings) {
      const resolved = state.values[field.key];
      const value = describeResolvedFieldValue(
        service.id,
        field,
        resolved?.value ?? null,
        resolved?.source ?? "missing",
      );
      serviceLines.push(`  ${field.label}: ${value}`);
    }

    for (const field of service.optionalSettings) {
      const resolved = state.values[field.key];
      if (resolved && resolved.value !== null) {
        const value = describeResolvedFieldValue(
          service.id,
          field,
          resolved.value,
          resolved.source,
        );
        serviceLines.push(`  ${field.label}: ${value}`);
      }
    }

    if (state.errors.length > 0) {
      serviceLines.push("  Configuration errors:");
      for (const error of state.errors) {
        serviceLines.push(`    ${error}`);
      }
    }

    if (serviceLines.length > 1) {
      lines.push(...serviceLines, "");
    }
  }

  lines.push("Git search roots");
  try {
    const roots = resolveSearchRoots();
    const hasEnvRootsOverride = trimEnvValue(process.env[ENV.GIT_SEARCH_ROOTS]) !== null;
    const envRoots = parseSearchRootsInput(process.env[ENV.GIT_SEARCH_ROOTS]);
    const configuredRoots = hasEnvRootsOverride ? [] : readSearchRootsConfig();
    lines.push(`  effective: ${roots.length > 0 ? roots.join(", ") : "(none)"}`);
    lines.push(
      `  configured: ${
        hasEnvRootsOverride
          ? `${envRoots.length > 0 ? envRoots.join(", ") : "(none)"} (environment)`
          : configuredRoots.length > 0
            ? configuredRoots.join(", ")
            : "(default roots)"
      }`,
    );
  } catch (error) {
    lines.push(`  Configuration error: ${errorMessage(error)}`);
  }
  lines.push("");
  try {
    lines.push(`Credentials file: ${configFilePath()}`);
  } catch (error) {
    lines.push(`Credentials file: unavailable (${errorMessage(error)})`);
  }

  return `${lines.join("\n")}\n`;
}

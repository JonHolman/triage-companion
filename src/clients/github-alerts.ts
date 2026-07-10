import {
  normalizedKnownSeverity,
  severityRank,
} from "../severity.ts";
import {
  githubPermissionText,
  resolveToken,
} from "./github-auth.ts";
import {
  GITHUB_API_HOST,
} from "./github-constants.ts";
import type {
  DependabotAlert,
} from "./github-types.ts";
import {
  ghFetchWithErrorContext,
  gitHubPaginationLoopKey,
  nextURL,
  recordGitHubPaginationURL,
  validateGitHubPaginationURL,
} from "./github-api.ts";
import {
  githubErrorMessage,
  hasCanonicalTextValue,
  hasPresentNonRecordField,
  hasPresentNonStringField,
  inlineErrorText,
  isDependabotAlertResponse,
  isRecord,
  numberField,
  parseGitHubJSON,
  recordField,
  stringField,
} from "./github-response.ts";
import {
  requireDependabotAlertWebURL,
  validatePositiveIntegerOption,
  uniqueRepositoryFullNames,
} from "./github-url.ts";

function parseAlertRecord(
  alert: Record<string, unknown>,
  encodedRepositoryName: string,
): DependabotAlert {
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
  if (hasPresentNonStringField(vulnerability, "severity") || hasPresentNonStringField(advisory, "severity")) {
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
  if (hasPresentNonStringField(vulnerability, "vulnerable_version_range")) {
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
  if (hasPresentNonStringField(patchedVersion, "identifier")) {
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
  if (hasPresentNonStringField(dependency, "manifest_path")) {
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
    state: alert.state as string,
    vulnerableRange: vulnerableRange ?? null,
    patchedVersion: patchedVersionIdentifier ?? null,
    manifestPath: manifestPath ?? null,
    url,
    summary,
  };
}

async function listSecurityAlertsForRepository(
  encodedRepositoryName: string,
  token: string,
  limit: number,
): Promise<DependabotAlert[]> {
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

    repoAlerts.push(...alertPage.map((alert) => parseAlertRecord(alert, encodedRepositoryName)));

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
      batch.map((repositoryName) =>
        listSecurityAlertsForRepository(repositoryName, token, limit),
      ),
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

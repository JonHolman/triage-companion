import { normalizedKnownSeverity, severityRank } from "../severity.ts";
import {
  configuredOrgIDs,
  currentAPIBaseURL,
  hasToken,
  removeAPIBaseURL,
  removeToken,
  resolveBaseURL,
  resolveToken,
  saveAPIBaseURL,
  saveToken,
  snykPermissionText,
  validateSeverityFilter,
  apiBaseURLEnvOverrideState,
} from "./snyk-config.ts";
import { paginate } from "./snyk-runtime.ts";
import {
  invalidStringCandidate,
  isRecord,
  parseDate,
  pickString,
  requiredProjectID,
  snykIssueWebURL,
  validateAPIPathID,
  validatedStringCandidate,
} from "./snyk-parse.ts";
import type {
  ListOpenIssuesOptions,
  SnykIssue,
  SnykIssueSnapshot,
  SnykOrganization,
} from "./snyk-types.ts";

export {
  apiBaseURLEnvOverrideState,
  currentAPIBaseURL,
  hasToken,
  removeAPIBaseURL,
  removeToken,
  saveAPIBaseURL,
  saveToken,
};

function parseOrganization(org: { id?: string; attributes?: Record<string, unknown> }): SnykOrganization {
  if (org.id === undefined) {
    throw new Error("Snyk API response included an organization without an id.");
  }

  const organizationID = validateAPIPathID(org.id, "Snyk organization ID");
  const organizationAttributes = org.attributes;
  if (!organizationAttributes) {
    throw new Error(`Snyk organization ${organizationID} attributes must be an object.`);
  }
  const organizationSlug = pickString(organizationAttributes, ["slug"]);
  if (!organizationSlug) {
    const invalidOrganizationSlug = invalidStringCandidate(organizationAttributes, ["slug"]);
    if (invalidOrganizationSlug) {
      throw new Error(
        `Snyk organization ${organizationID} ${invalidOrganizationSlug.key} ${invalidOrganizationSlug.reason}.`,
      );
    }
    throw new Error(`Snyk organization missing slug: ${organizationID}`);
  }
  const organizationName = pickString(organizationAttributes, ["name"]);
  if (!organizationName) {
    const invalidOrganizationName = invalidStringCandidate(organizationAttributes, ["name"]);
    if (invalidOrganizationName) {
      throw new Error(
        `Snyk organization ${organizationID} ${invalidOrganizationName.key} ${invalidOrganizationName.reason}.`,
      );
    }
    throw new Error(`Snyk organization missing name: ${organizationID}`);
  }

  return {
    id: organizationID,
    slug: validateAPIPathID(organizationSlug, "Snyk organization slug"),
    name: organizationName,
  };
}

async function loadOrganizations(token: string, baseURL: string): Promise<SnykOrganization[]> {
  const orgData = await paginate("/orgs", {}, token, baseURL);
  const organizations: SnykOrganization[] = [];
  const seenOrganizationIDs = new Set<string>();

  for (const org of orgData) {
    const organization = parseOrganization(org);
    if (seenOrganizationIDs.has(organization.id)) {
      continue;
    }

    seenOrganizationIDs.add(organization.id);
    organizations.push(organization);
  }

  return organizations;
}

function filterOrganizations(
  organizations: SnykOrganization[],
  filterIDs: readonly string[],
): SnykOrganization[] {
  if (filterIDs.length === 0) {
    return organizations;
  }

  const allowed = new Set(filterIDs);
  const filtered = organizations.filter((org) => allowed.has(org.id));
  if (filtered.length === 0) {
    throw new Error(
      `No accessible orgs match TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS: ${filterIDs.join(", ")}`,
    );
  }

  return filtered;
}

function parseProjectName(project: { id?: string; attributes?: Record<string, unknown> }): [string, string] {
  if (project.id === undefined) {
    throw new Error("Snyk API response included a project without an id.");
  }

  const projectID = validateAPIPathID(project.id, "Snyk project ID");
  const projectAttributes = project.attributes;
  if (!projectAttributes) {
    throw new Error(`Snyk project ${projectID} attributes must be an object.`);
  }
  const name = validatedStringCandidate(
    projectAttributes,
    ["name", "target_reference", "origin"],
    `Snyk project ${projectID}`,
  );
  if (!name) {
    throw new Error(`Snyk project missing name: ${projectID}`);
  }

  return [projectID, name];
}

async function loadProjectNames(
  orgID: string,
  token: string,
  baseURL: string,
): Promise<Map<string, string>> {
  const encodedOrgID = encodeURIComponent(orgID);
  const projectData = await paginate(`/orgs/${encodedOrgID}/projects`, {}, token, baseURL);
  const projectNames = new Map<string, string>();
  for (const project of projectData) {
    const [projectID, projectName] = parseProjectName(project);
    projectNames.set(projectID, projectName);
  }

  return projectNames;
}

function validateIssueSeverity(
  attributes: Record<string, unknown>,
  issueId: string,
): string {
  const issueSeverity = validatedStringCandidate(
    attributes,
    ["effective_severity_level"],
    `Snyk issue ${issueId}`,
  );
  if (!issueSeverity) {
    throw new Error(`Snyk issue missing severity: ${issueId}`);
  }
  if (!normalizedKnownSeverity(issueSeverity)) {
    throw new Error(
      `Snyk issue ${issueId} severity must be one of critical, high, medium, or low.`,
    );
  }
  return issueSeverity;
}

function validateIssueStatus(attributes: Record<string, unknown>, issueId: string): string {
  const issueStatus = validatedStringCandidate(
    attributes,
    ["status"],
    `Snyk issue ${issueId}`,
  );
  if (!issueStatus) {
    throw new Error(`Snyk issue missing status: ${issueId}`);
  }
  if (issueStatus.toLowerCase() !== "open") {
    throw new Error(`Snyk issue ${issueId} must have status open.`);
  }
  if (typeof attributes.ignored !== "boolean") {
    throw new Error(`Snyk issue ${issueId} ignored must be a boolean.`);
  }
  if (attributes.ignored) {
    throw new Error(`Snyk issue ${issueId} must not be ignored.`);
  }

  return issueStatus;
}

function resolveIssueProjectName(
  issueId: string,
  projectID: string,
  projectNames: Map<string, string>,
): string {
  const name = projectNames.get(projectID);
  if (!name) {
    throw new Error(`Snyk issue ${issueId} references unknown project ${projectID}.`);
  }

  return name;
}

function parseIssueDates(
  attributes: Record<string, unknown>,
  issueId: string,
): { introducedAt: Date; updatedAt: Date } {
  const introducedAtText = validatedStringCandidate(
    attributes,
    ["created_at"],
    `Snyk issue ${issueId}`,
  );
  const updatedAtText = validatedStringCandidate(
    attributes,
    ["updated_at"],
    `Snyk issue ${issueId}`,
  );
  const introducedAt = parseDate(introducedAtText);
  if (!introducedAt) {
    throw new Error(`Snyk issue invalid introduced timestamp: ${issueId}`);
  }
  const updatedAt = parseDate(updatedAtText);
  if (!updatedAt) {
    throw new Error(`Snyk issue invalid updated timestamp: ${issueId}`);
  }

  return { introducedAt, updatedAt };
}

function parsePackageName(attributes: Record<string, unknown>, issueId: string): string | null {
  const coordinates = attributes.coordinates;
  if (coordinates === undefined) {
    return null;
  }
  if (!Array.isArray(coordinates)) {
    throw new Error(`Snyk issue ${issueId} coordinates must be an array.`);
  }

  for (const coordinate of coordinates) {
    if (!isRecord(coordinate)) {
      throw new Error(`Snyk issue ${issueId} coordinates entries must be objects.`);
    }

    const representations = coordinate.representations;
    if (!Array.isArray(representations)) {
      throw new Error(`Snyk issue ${issueId} coordinate representations must be an array.`);
    }

    for (const representation of representations) {
      if (!isRecord(representation)) {
        throw new Error(`Snyk issue ${issueId} coordinate representations entries must be objects.`);
      }
      if (representation.package === undefined) {
        continue;
      }

      const name = validatedStringCandidate(
        representation.package,
        ["name"],
        `Snyk issue ${issueId} package`,
      );
      if (name) {
        return name;
      }
    }
  }

  return null;
}

function parseIssue(
  item: { id?: string; attributes?: Record<string, unknown> },
  org: SnykOrganization,
  projectNames: Map<string, string>,
  severity: string | undefined,
  baseURL: string,
): SnykIssue | null {
  const rawIssueId = item.id;
  if (rawIssueId === undefined) {
    throw new Error("Snyk API response included an issue without an id.");
  }
  const issueId = validateAPIPathID(rawIssueId, "Snyk issue ID");
  const attributes = item.attributes;
  if (!attributes) {
    throw new Error(`Snyk issue ${issueId} attributes must be an object.`);
  }

  const projectID = requiredProjectID(item, `Snyk issue ${issueId}`);
  const issueSeverity = validateIssueSeverity(attributes, issueId);
  const issueStatus = validateIssueStatus(attributes, issueId);
  if (severity && issueSeverity.toLowerCase() !== severity) {
    return null;
  }
  const issueType = validatedStringCandidate(attributes, ["type"], `Snyk issue ${issueId}`);
  if (!issueType) {
    throw new Error(`Snyk issue missing type: ${issueId}`);
  }
  const issueTitle = validatedStringCandidate(attributes, ["title"], `Snyk issue ${issueId}`);
  if (!issueTitle) {
    throw new Error(`Snyk issue missing title: ${issueId}`);
  }
  const issueKey = validatedStringCandidate(attributes, ["key"], `Snyk issue ${issueId}`);
  if (!issueKey) {
    throw new Error(`Snyk issue missing key: ${issueId}`);
  }

  const projectName = resolveIssueProjectName(issueId, projectID, projectNames);
  const { introducedAt, updatedAt } = parseIssueDates(attributes, issueId);

  return {
    id: `${org.id}#${issueId}`,
    url: snykIssueWebURL(baseURL, org.slug, projectID, issueKey),
    title: issueTitle,
    severity: issueSeverity,
    status: issueStatus,
    issueType,
    organizationID: org.id,
    organizationSlug: org.slug,
    organizationName: org.name,
    projectID,
    projectName,
    issueKey,
    packageName: parsePackageName(attributes, issueId),
    introducedAt,
    updatedAt,
  };
}

function sortIssues(issues: SnykIssue[]): void {
  issues.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.organizationName.localeCompare(b.organizationName) ||
      a.projectName.localeCompare(b.projectName) ||
      b.updatedAt.getTime() - a.updatedAt.getTime() ||
      a.title.localeCompare(b.title),
  );
}

export async function listOpenIssues({
  severity,
}: ListOpenIssuesOptions = {}): Promise<SnykIssueSnapshot> {
  const validatedSeverity = validateSeverityFilter(severity);
  const filterIDs = configuredOrgIDs();
  const baseURL = resolveBaseURL();
  const token = resolveToken();
  if (!token) {
    throw new Error(
      `Snyk token not configured. Save one with ` +
        "`triage-companion snyk token <token>` or set SNYK_TOKEN. " +
        `Required permissions: ${snykPermissionText}`,
    );
  }

  const organizations = filterOrganizations(
    await loadOrganizations(token, baseURL),
    filterIDs,
  );
  const issues: SnykIssue[] = [];
  const projectKeys = new Set<string>();

  for (const org of organizations) {
    const projectNames = await loadProjectNames(org.id, token, baseURL);
    const issueData = await paginate(
      `/orgs/${encodeURIComponent(org.id)}/issues`,
      {
        status: "open",
        ignored: "false",
      },
      token,
      baseURL,
    );

    for (const item of issueData) {
      const issue = parseIssue(item, org, projectNames, validatedSeverity, baseURL);
      if (!issue) {
        continue;
      }

      issues.push(issue);
      projectKeys.add(`${org.id}#${issue.projectID}`);
    }
  }

  sortIssues(issues);

  return {
    issues,
    organizationCount: organizations.length,
    projectCount: projectKeys.size,
    checkedAt: new Date(),
  };
}

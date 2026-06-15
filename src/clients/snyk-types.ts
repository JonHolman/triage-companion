export interface SnykRecord {
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

export interface SnykOrganization {
  id: string;
  slug: string;
  name: string;
}

export interface SnykIssue {
  id: string;
  url: string;
  title: string;
  severity: string;
  status: string;
  issueType: string;
  organizationID: string;
  organizationSlug: string;
  organizationName: string;
  projectID: string | null;
  projectName: string;
  issueKey: string | null;
  packageName: string | null;
  introducedAt: Date | null;
  updatedAt: Date | null;
}

export interface SnykIssueSnapshot {
  issues: SnykIssue[];
  organizationCount: number;
  projectCount: number;
  checkedAt: Date;
}

export interface ListOpenIssuesOptions {
  severity?: string;
}

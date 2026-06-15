export interface NotificationSubject {
  type?: string;
  title?: string;
  url?: string;
}

export interface NotificationRepository {
  full_name?: string;
  html_url?: string;
}

export interface GitHubNotificationApi {
  id: string | number;
  repository?: NotificationRepository;
  subject?: NotificationSubject;
  reason?: string;
  updated_at?: string;
  unread?: boolean;
}

export interface GitHubNotification {
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

export interface PrDetails {
  state: string | null;
  merged: boolean | null;
  author: string | null;
}

export interface PullRequestSummary {
  state: string | null;
  headRef: string;
}

export interface OpenPullRequest {
  repositoryPath: string;
  repositoryName: string;
  branch: string;
  pullRequestNumber: number;
  url: string;
  author: string;
  headSHA: string;
}

export interface OpenPullRequestOptions {
  repositoryPaths?: string[];
  searchRoots?: string[];
  authorRegex?: string | null;
  githubLogin?: string | null;
}

export interface DependabotAlert {
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

export interface FailedWorkflowRun {
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

export interface WorkflowRunResponse extends Record<string, unknown> {
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

export interface PullRequestSummaryResponse extends Record<string, unknown> {
  state: string;
  head: {
    ref: string;
  };
}

export interface GitHubRef {
  sha: string;
  ref: string;
}

export interface GhFetchOptions {
  method?: "GET" | "PATCH";
}

import {
  githubPermissionText,
  resolveToken,
} from "./github-auth.ts";
import {
  GITHUB_API_HOST,
} from "./github-constants.ts";
import type {
  FailedWorkflowRun,
  WorkflowRunResponse,
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
  isRecord,
  isWorkflowRunResponse,
  numberField,
  parseGitHubJSON,
  stringField,
} from "./github-response.ts";
import {
  parseGitHubDate,
  requireWorkflowRunWebURL,
  validatePositiveIntegerOption,
  validateRepositoryFullName,
} from "./github-url.ts";

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

function parseWorkflowRun(
  run: WorkflowRunResponse,
  encodedRepositoryName: string,
): FailedWorkflowRun {
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
}

async function listFailedWorkflowRunsForRepository(
  encodedRepositoryName: string,
  token: string,
  limit: number,
): Promise<FailedWorkflowRun[]> {
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

    repoRuns.push(...workflowRuns.map((run) => parseWorkflowRun(run, encodedRepositoryName)));

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

  return repoRuns.slice(0, limit);
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
    const repoRuns = await listFailedWorkflowRunsForRepository(
      encodedRepositoryName,
      token,
      limit,
    );
    runs.push(...repoRuns);
  }

  return runs.sort(
    (left, right) =>
      (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0) ||
      left.repositoryFullName.localeCompare(right.repositoryFullName) ||
      left.workflowName.localeCompare(right.workflowName),
  );
}

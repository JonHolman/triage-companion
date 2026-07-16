import {
  GITHUB_API_HOST,
} from "./github-constants.ts";
import {
  ghFetchWithErrorContext,
} from "./github-api.ts";
import {
  resolveToken,
} from "./github-auth.ts";
import {
  githubErrorMessage,
  hasCanonicalTextValue,
  isRecord,
  parseGitHubJSON,
} from "./github-response.ts";
import type {
  PullRequestMergeResult,
} from "./github-types.ts";
import {
  isGitObjectIDText,
  parsePullRequestWebURL,
} from "./github-url.ts";

const mergePullRequestPermissionText =
  "classic personal access token with notifications plus repo for private repositories or public_repo for public repositories; token account must have write access";

export async function mergePullRequestFromWebURL(webURL: string): Promise<PullRequestMergeResult> {
  const { repositoryFullName, pullRequestNumber } = parsePullRequestWebURL(webURL);
  const token = resolveToken();
  if (!token) {
    throw new Error(
      `GitHub token not configured. Required permissions: ${mergePullRequestPermissionText}.`,
    );
  }

  const response = await ghFetchWithErrorContext(
    `https://${GITHUB_API_HOST}/repos/${repositoryFullName}/pulls/${pullRequestNumber}/merge`,
    token,
    `Could not merge GitHub pull request #${pullRequestNumber} in ${repositoryFullName}`,
    { method: "PUT" },
  );
  if (!response.ok) {
    const message = await githubErrorMessage(response);
    const baseMessage =
      `GitHub API HTTP ${response.status} while merging pull request #${pullRequestNumber} in ${repositoryFullName}: ${message}`;
    if (response.status === 403) {
      throw new Error(`${baseMessage}. Required permissions: ${mergePullRequestPermissionText}.`);
    }

    throw new Error(baseMessage);
  }

  const body = await parseGitHubJSON(response, "GitHub merge pull request response");
  if (!isRecord(body)) {
    throw new Error("GitHub merge pull request response must be an object.");
  }
  if (body.merged !== true) {
    throw new Error("GitHub merge pull request response must report merged=true.");
  }
  const sha = typeof body.sha === "string" ? body.sha : "";
  if (!isGitObjectIDText(sha)) {
    throw new Error("GitHub merge pull request response must include a full object ID.");
  }
  const message = typeof body.message === "string" ? body.message : "";
  if (!hasCanonicalTextValue(message)) {
    throw new Error("GitHub merge pull request response must include a message.");
  }

  return {
    repositoryFullName,
    pullRequestNumber,
    sha,
    message,
  };
}

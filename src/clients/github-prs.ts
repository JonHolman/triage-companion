import path from "node:path";

import { ENV } from "../config.ts";
import {
  DEFAULT_IGNORED_PR_BRANCHES,
  parseJSONStringArray,
  validateGitHubIgnoredBranchNames,
} from "../config-model.ts";
import { trimEnvValue } from "../config-path.ts";
import {
  findGitRepositories,
  normalizeRepositorySearchRoots,
  resolveRepositorySearchRoots,
} from "../git/search.ts";
import {
  requireGitBinary,
  runGitCommand,
} from "../git/executor.ts";
import {
  GITHUB_API_HOST,
} from "./github-constants.ts";
import {
  resolveAuthenticatedLogin,
  ghFetchWithErrorContext,
} from "./github-api.ts";
import {
  resolveToken,
  validateConfiguredText,
} from "./github-auth.ts";
import {
  buildAuthorPattern,
  defaultAuthorPattern,
} from "./github-author.ts";
import type {
  GitHubRef,
  OpenPullRequest,
  OpenPullRequestOptions,
  PullRequestSummary,
} from "./github-types.ts";
import {
  branchName,
  pullRequestNumber,
  remoteRefs,
  validatePullRequestRef,
} from "./github-refs.ts";
import {
  hasCanonicalTextValue,
  isCommitResponse,
  isPullRequestSummaryResponse,
  isRecord,
  parseGitHubJSON,
  recordField,
  stringField,
  githubErrorMessage,
} from "./github-response.ts";
import {
  validateExplicitRepositoryPaths,
} from "./github-repositories.ts";
import {
  invalidGitHubRemoteConfigurationMessage,
  isMissingLocalGitObjectError,
  isMissingRepositoryContextError,
  remoteRepositoryFullName,
  validateRepositoryPath,
} from "./github-remotes.ts";

const DEFAULT_IGNORED_BRANCH_SET = new Set<string>(DEFAULT_IGNORED_PR_BRANCHES);

async function loadPullRequestSummary(
  repositoryFullName: string,
  pullRequestNumberValue: number,
  token: string | null,
): Promise<PullRequestSummary> {
  const response = await ghFetchWithErrorContext(
    `https://${GITHUB_API_HOST}/repos/${repositoryFullName}/pulls/${pullRequestNumberValue}`,
    token,
    `Could not look up GitHub pull request #${pullRequestNumberValue} in ${repositoryFullName}`,
  );

  if (!response.ok) {
    throw new Error(
      `GitHub API HTTP ${response.status} while checking pull request #${pullRequestNumberValue} in ${repositoryFullName}: ${await githubErrorMessage(response)}`,
    );
  }

  const body = await parseGitHubJSON(response, "GitHub pull request response");
  if (!isRecord(body)) {
    throw new Error("GitHub pull request response must be an object.");
  }
  if (!isPullRequestSummaryResponse(body)) {
    throw new Error("GitHub pull request response must be an object with valid top-level fields.");
  }

  return {
    state: body.state,
    headRef: body.head.ref,
  };
}

async function commitAuthorFromGitHub(
  repositoryFullName: string,
  sha: string,
  token: string | null,
): Promise<string> {
  const response = await ghFetchWithErrorContext(
    `https://${GITHUB_API_HOST}/repos/${repositoryFullName}/commits/${sha}`,
    token,
    `Could not load GitHub commit ${sha} in ${repositoryFullName}`,
  );

  if (!response.ok) {
    throw new Error(
      `GitHub API HTTP ${response.status} while loading commit ${sha} in ${repositoryFullName}: ${await githubErrorMessage(response)}`,
    );
  }

  const body = await parseGitHubJSON(response, "GitHub commit response");
  if (!isRecord(body)) {
    throw new Error("GitHub commit response must be an object.");
  }
  if (!isCommitResponse(body)) {
    throw new Error("GitHub commit response must be an object with valid top-level fields.");
  }

  const commit = recordField(body, "commit");
  const commitAuthor = recordField(commit, "author");
  const author = recordField(body, "author");
  const values = [
    stringField(commitAuthor, "name"),
    stringField(commitAuthor, "email"),
    stringField(author, "login"),
  ].filter((value): value is string => value !== undefined);
  if (values.length === 0) {
    throw new Error(`GitHub commit ${sha} in ${repositoryFullName} missing author identity.`);
  }

  return values.join(" ");
}

function configuredIgnoredBranches(): Set<string> {
  if (trimEnvValue(process.env[ENV.GITHUB_PR_IGNORE_BRANCHES]) === null) {
    return DEFAULT_IGNORED_BRANCH_SET;
  }

  const raw = parseJSONStringArray(
    process.env[ENV.GITHUB_PR_IGNORE_BRANCHES],
    "GitHub ignored branch list",
  );
  const validation = validateGitHubIgnoredBranchNames(raw);
  if (validation !== null) {
    throw new Error(`GitHub ignored branch list ${validation}.`);
  }

  return new Set(raw);
}

export async function listMyOpenPullRequests({
  repositoryPaths,
  searchRoots,
  authorRegex = null,
  githubLogin = null,
}: OpenPullRequestOptions = {}): Promise<OpenPullRequest[]> {
  const explicitAuthorPattern = buildAuthorPattern(authorRegex);
  const validatedGitHubLogin = githubLogin === null
    ? null
    : validateConfiguredText(githubLogin, "GitHub login");
  const hasExplicitRepositoryPaths = repositoryPaths !== undefined;
  const hasExplicitSearchRoots = searchRoots !== undefined;
  const normalizedSearchRoots = hasExplicitSearchRoots
    ? normalizeRepositorySearchRoots(searchRoots)
    : [];
  const repos = hasExplicitRepositoryPaths
    ? validateExplicitRepositoryPaths(repositoryPaths)
    : findGitRepositories(
      hasExplicitSearchRoots ? normalizedSearchRoots : resolveRepositorySearchRoots(),
    );
  if (repos.length === 0) {
    return [];
  }

  const gitBinary = requireGitBinary();
  let resolvedToken: string | null | undefined;

  const ignoredBranches = configuredIgnoredBranches();
  let resolvedLogin = validatedGitHubLogin;
  let hasResolvedLogin = validatedGitHubLogin !== null;
  let resolvedLoginError: Error | null = null;

  const resolveTokenIfNeeded = (): string | null => {
    if (resolvedToken === undefined) {
      resolvedToken = resolveToken();
    }

    return resolvedToken;
  };

  const resolveLoginIfNeeded = async (): Promise<string | null> => {
    if (hasResolvedLogin) {
      return resolvedLogin;
    }

    hasResolvedLogin = true;
    try {
      resolvedLogin = await resolveAuthenticatedLogin();
    } catch (error) {
      resolvedLoginError = error instanceof Error ? error : new Error(String(error));
      resolvedLogin = null;
    }

    return resolvedLogin;
  };

  const items: OpenPullRequest[] = [];

  for (const repositoryPath of repos) {
    validateRepositoryPath(repositoryPath);
    let resolvedFullName: string | null;
    try {
      const rawRemoteURL = runGitCommand(gitBinary, ["-C", repositoryPath, "remote", "get-url", "origin"]);
      resolvedFullName = remoteRepositoryFullName(rawRemoteURL);
      if (!resolvedFullName) {
        const invalidRemoteMessage = invalidGitHubRemoteConfigurationMessage(rawRemoteURL);
        if (invalidRemoteMessage) {
          throw new Error(invalidRemoteMessage);
        }
      }
    } catch (error) {
      if (isMissingRepositoryContextError(error)) {
        continue;
      }

      throw error;
    }

    if (!resolvedFullName) {
      continue;
    }

    const repositoryFullName = resolvedFullName;
    const repositoryURL = `https://github.com/${repositoryFullName}`;
    const branchRefs: GitHubRef[] = remoteRefs(
      runGitCommand(gitBinary, [
        "-C",
        repositoryPath,
        "ls-remote",
        "origin",
        "refs/heads/*",
      ]),
    );
    for (const ref of branchRefs) {
      branchName(ref.ref);
    }
    const pullRefs: GitHubRef[] = remoteRefs(
      runGitCommand(gitBinary, [
        "-C",
        repositoryPath,
        "ls-remote",
        "origin",
        "refs/pull/*/head",
        "refs/pull/*/merge",
      ]),
    );
    for (const ref of pullRefs) {
      validatePullRequestRef(ref.ref);
    }

    if (pullRefs.length === 0) {
      continue;
    }

    const openPullRequestNumbers = new Set(
      pullRefs
        .map((ref) => pullRequestNumber(ref.ref, "/merge"))
        .filter((id): id is number => id !== null),
    );

    const headRefsBySHA = new Map<string, GitHubRef[]>();
    for (const ref of pullRefs.filter((ref) => ref.ref.endsWith("/head"))) {
      const entries = headRefsBySHA.get(ref.sha) ?? [];
      entries.push(ref);
      headRefsBySHA.set(ref.sha, entries);
    }

    const branchRefsBySHA = new Map<string, GitHubRef[]>();
    for (const ref of branchRefs) {
      const entries = branchRefsBySHA.get(ref.sha) ?? [];
      entries.push(ref);
      branchRefsBySHA.set(ref.sha, entries);
    }

    const pullRequestSummaryPromises = new Map<number, Promise<PullRequestSummary>>();
    const loadPullRequestSummaryIfNeeded = (
      pullRequestNumberValue: number,
    ): Promise<PullRequestSummary> => {
      const existing = pullRequestSummaryPromises.get(pullRequestNumberValue);
      if (existing) {
        return existing;
      }

      const pending = loadPullRequestSummary(
        repositoryFullName,
        pullRequestNumberValue,
        resolveTokenIfNeeded(),
      );
      pullRequestSummaryPromises.set(pullRequestNumberValue, pending);
      return pending;
    };

    let authorPattern = explicitAuthorPattern;
    for (const branchRef of branchRefs) {
      const branch = branchName(branchRef.ref);
      if (ignoredBranches.has(branch)) {
        continue;
      }

      const matchingHead = headRefsBySHA.get(branchRef.sha);
      if (!matchingHead?.length) {
        continue;
      }

      const candidatePullRequestNumbers = [...new Set(
        matchingHead
          .map((item) => pullRequestNumber(item.ref, "/head"))
          .filter((id): id is number => id !== null),
      )];

      if (candidatePullRequestNumbers.length === 0) {
        continue;
      }

      const sharedBranchRefs = branchRefsBySHA.get(branchRef.sha) ?? [];
      const isAmbiguousBranchSHA = sharedBranchRefs.length > 1;
      const requiresHeadRefDisambiguation =
        isAmbiguousBranchSHA || candidatePullRequestNumbers.length > 1;
      const matchingPullRequestNumbers: number[] = [];

      for (const candidatePullRequestNumber of candidatePullRequestNumbers) {
        if (requiresHeadRefDisambiguation) {
          const summary = await loadPullRequestSummaryIfNeeded(candidatePullRequestNumber);
          if (summary.state !== "open") {
            continue;
          }

          if (summary.headRef !== branch) {
            continue;
          }

          matchingPullRequestNumbers.push(candidatePullRequestNumber);
          continue;
        }

        if (openPullRequestNumbers.has(candidatePullRequestNumber)) {
          matchingPullRequestNumbers.push(candidatePullRequestNumber);
          continue;
        }

        const summary = await loadPullRequestSummaryIfNeeded(candidatePullRequestNumber);
        if (summary.state === "open") {
          matchingPullRequestNumbers.push(candidatePullRequestNumber);
        }
      }

      if (matchingPullRequestNumbers.length === 0) {
        continue;
      }

      if (authorPattern === null) {
        authorPattern = defaultAuthorPattern(gitBinary, validatedGitHubLogin, repositoryPath);
      }
      if (!authorPattern) {
        const githubLoginForPattern = await resolveLoginIfNeeded();
        authorPattern = githubLoginForPattern
          ? defaultAuthorPattern(gitBinary, githubLoginForPattern, repositoryPath)
          : null;
      }
      if (!authorPattern) {
        if (resolvedLoginError) {
          throw resolvedLoginError;
        }

        throw new Error(
          "Could not determine your git author identity. Set GITHUB_TOKEN so your GitHub login can be inferred, configure git user.name/user.email, or pass --github-login <login> / --author-regex <pattern>.",
        );
      }

      let localObjectMissing = false;
      try {
        runGitCommand(gitBinary, ["-C", repositoryPath, "cat-file", "-e", branchRef.sha]);
      } catch (error) {
        if (!isMissingLocalGitObjectError(error)) {
          throw error;
        }

        localObjectMissing = true;
      }

      const author = localObjectMissing
        ? await commitAuthorFromGitHub(
          repositoryFullName,
          branchRef.sha,
          resolveTokenIfNeeded(),
        )
        : runGitCommand(gitBinary, [
          "-C",
          repositoryPath,
          "log",
          "-1",
          "--format=%an %ae",
          branchRef.sha,
        ]);

      if (!hasCanonicalTextValue(author)) {
        throw new Error(`Git commit ${branchRef.sha} in ${repositoryFullName} must include a valid author identity.`);
      }

      if (!authorPattern.test(author)) {
        continue;
      }

      for (const matchingPullRequestNumber of matchingPullRequestNumbers) {
        items.push({
          repositoryPath,
          repositoryName: path.basename(repositoryPath),
          branch,
          pullRequestNumber: matchingPullRequestNumber,
          url: `${repositoryURL}/pull/${matchingPullRequestNumber}`,
          author,
          headSHA: branchRef.sha,
        });
      }
    }
  }

  return items.sort((left, right) => {
    if (left.repositoryName !== right.repositoryName) {
      return left.repositoryName.localeCompare(right.repositoryName);
    }

    return left.branch.localeCompare(right.branch);
  });
}

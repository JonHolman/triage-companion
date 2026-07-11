import {
  validateRegularExpression,
} from "../config-model.ts";
import {
  runGitCommand,
} from "../git/executor.ts";
import {
  hasCanonicalTextValue,
} from "./github-response.ts";
import {
  isMissingGitConfigValueError,
} from "./github-remotes.ts";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function defaultAuthorPattern(
  gitBinary: string,
  githubLogin: string | null,
  repositoryPath: string,
): RegExp | null {
  const patterns: string[] = [];
  for (const key of ["user.name", "user.email"]) {
    try {
      const value = runGitCommand(gitBinary, ["-C", repositoryPath, "config", "--get", key]);
      if (!hasCanonicalTextValue(value)) {
        throw new Error(`Git config ${key} in ${repositoryPath} must include a valid value.`);
      }

      patterns.push(`(?:^|\\s)${escapeRegex(value)}(?:$|\\s)`);
    } catch (error) {
      if (!isMissingGitConfigValueError(error)) {
        throw error;
      }

      continue;
    }
  }

  if (githubLogin) {
    const escapedLogin = escapeRegex(githubLogin);
    patterns.push(`(?:^|\\s)${escapedLogin}(?:$|\\s)`);
    patterns.push(`(?:^|\\s)(?:\\d+\\+)?${escapedLogin}@users\\.noreply\\.github\\.com(?:$|\\s)`);
  }

  if (patterns.length === 0) {
    return null;
  }

  return new RegExp(patterns.join("|"), "i");
}

export function buildAuthorPattern(raw: string | null): RegExp | null {
  if (raw === null) {
    return null;
  }
  if (raw.length === 0) {
    throw new Error("GitHub PR author regex must not be empty.");
  }

  const validation = validateRegularExpression(raw);
  if (validation) {
    throw new Error(`GitHub PR author regex ${validation}.`);
  }

  return new RegExp(raw, "i");
}

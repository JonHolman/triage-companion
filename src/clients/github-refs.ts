import type {
  GitHubRef,
} from "./github-types.ts";
import {
  hasCanonicalTextValue,
} from "./github-response.ts";
import {
  isGitObjectIDText,
  parsePositiveSafeIntegerText,
} from "./github-url.ts";

export function remoteRefs(output: string): GitHubRef[] {
  return output
    .split("\n")
    .map((line) => line.replace(/[\r\n]+$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.trim() !== line) {
        throw new Error("Git remote ref output must not include surrounding whitespace.");
      }

      const parts = line.split("\t");
      if (parts.length !== 2) {
        throw new Error("Git remote ref output lines must contain an object ID and ref separated by a tab.");
      }

      const sha = parts[0] ?? "";
      const ref = parts[1] ?? "";
      if (!isGitObjectIDText(sha)) {
        throw new Error("Git remote ref output must include full object IDs.");
      }
      if (!hasCanonicalTextValue(ref) || !ref.startsWith("refs/")) {
        throw new Error("Git remote ref output must include a valid ref name.");
      }

      return { sha, ref };
    });
}

export function branchName(ref: string): string {
  if (!ref.startsWith("refs/heads/")) {
    throw new Error("Git remote branch refs must match refs/heads/<branch>.");
  }

  const branch = ref.slice("refs/heads/".length);
  if (!hasCanonicalTextValue(branch)) {
    throw new Error("Git remote branch refs must match refs/heads/<branch>.");
  }

  return branch;
}

export function pullRequestNumber(ref: string, suffix: string): number | null {
  if (!ref.startsWith("refs/pull/") || !ref.endsWith(suffix)) {
    return null;
  }

  const numberText = ref.slice("refs/pull/".length, -suffix.length);
  return parsePositiveSafeIntegerText(numberText);
}

export function validatePullRequestRef(ref: string): void {
  if (!/^refs\/pull\/[1-9]\d*\/(?:head|merge)$/.test(ref)) {
    throw new Error("Git remote pull request refs must match refs/pull/<positive-number>/(head|merge).");
  }
}

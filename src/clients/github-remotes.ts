import {
  requireGitBinary,
  runGitCommand,
} from "../git/executor.ts";
import {
  repositoryFullNameFromURL,
  validateRepositoryFullName,
} from "./github-url.ts";

export function remoteRepositoryFullName(value: string): string | null {
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    return null;
  }
  const lowerValue = value.toLowerCase();

  if (lowerValue.startsWith("git@github.com:")) {
    return repositoryFullNameFromPath(
      stripGitSuffix(value.slice("git@github.com:".length)),
    );
  }
  if (lowerValue.startsWith("ssh://git@github.com/")) {
    return repositoryFullNameFromPath(
      stripGitSuffix(value.slice("ssh://git@github.com/".length)),
    );
  }
  if (lowerValue.startsWith("ssh://git@github.com:")) {
    return repositoryFullNameFromRemoteURL(value, "ssh:");
  }
  if (lowerValue.startsWith("https://")) {
    return repositoryFullNameFromRemoteURL(value, "https:");
  }
  return null;
}

export function remoteRepositoryURL(remoteURL: string): string | null {
  const repositoryFullName = remoteRepositoryFullName(remoteURL);
  return repositoryFullName ? `https://github.com/${repositoryFullName}` : null;
}

export function validateRepositoryPath(repositoryPath: string): void {
  if (/[\u0000-\u001F\u007F-\u009F]/.test(repositoryPath)) {
    throw new Error("Git repository path must not include control characters.");
  }
}

function isGitHubRemoteCandidate(value: string): boolean {
  const lowerValue = value.toLowerCase();
  if (
    lowerValue.startsWith("git@github.com:") ||
    lowerValue.startsWith("ssh://git@github.com/") ||
    lowerValue.startsWith("ssh://git@github.com:")
  ) {
    return true;
  }
  if (!lowerValue.startsWith("https://")) {
    return false;
  }

  try {
    return new URL(stripGitSuffix(value)).hostname === "github.com";
  } catch {
    return false;
  }
}

export function invalidGitHubRemoteConfigurationMessage(value: string): string | null {
  if (value.trim().length === 0) {
    return "Git remote origin URL must not be empty.";
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    return "Git remote origin URL must not include control characters.";
  }
  if (value.trim() !== value && isGitHubRemoteCandidate(value.trim())) {
    return "Git remote origin URL must not include surrounding whitespace.";
  }
  const lowerValue = value.toLowerCase();
  if (
    lowerValue.startsWith("git@github.com:") ||
    lowerValue.startsWith("ssh://git@github.com/") ||
    lowerValue.startsWith("ssh://git@github.com:")
  ) {
    return remoteRepositoryURL(value)
      ? null
      : "Git remote origin is not a valid GitHub repository URL.";
  }

  try {
    const url = new URL(stripGitSuffix(value));
    if (url.hostname !== "github.com") {
      return null;
    }

    return remoteRepositoryURL(value)
      ? null
      : "Git remote origin is not a valid GitHub repository URL.";
  } catch {
    return null;
  }
}

function repositoryFullNameFromRemoteURL(value: string, protocol: string): string | null {
  try {
    const url = new URL(stripGitSuffix(value));
    const hasAllowedPort = !url.port || (protocol === "ssh:" && url.port === "22");

    if (
      url.protocol !== protocol ||
      url.hostname !== "github.com" ||
      (protocol === "https:" && (url.username || url.password)) ||
      !hasAllowedPort ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return repositoryFullNameFromURL(stripGitSuffix(value));
  } catch {
    return null;
  }
}

function repositoryFullNameFromPath(value: string): string | null {
  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    parts[0]?.length === 0 ||
    parts[1]?.length === 0
  ) {
    return null;
  }

  try {
    return validateRepositoryFullName(`${parts[0]}/${parts[1]}`);
  } catch {
    return null;
  }
}

function stripGitSuffix(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  return normalized.endsWith(".git") ? normalized.slice(0, -4) : normalized;
}

export function gitCommandErrorText(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string") {
      return stderr;
    }
    if (stderr instanceof Uint8Array) {
      return Buffer.from(stderr).toString("utf-8");
    }
  }

  return error instanceof Error ? error.message : String(error);
}

export function isMissingRepositoryContextError(error: unknown): boolean {
  const message = gitCommandErrorText(error);
  return /not a git repository/i.test(message) || /no such remote ['"]?origin['"]?/i.test(message);
}

export function isMissingLocalGitObjectError(error: unknown): boolean {
  const message = gitCommandErrorText(error);
  if (
    error instanceof Error &&
    "status" in error &&
    error.status === 1 &&
    /\bcat-file -e\b/.test(error.message) &&
    message.length === 0
  ) {
    return true;
  }

  return /not a valid object name/i.test(message) ||
    /could not get object info/i.test(message) ||
    /bad object/i.test(message) ||
    /unknown revision or path not in the working tree/i.test(message);
}

export function isMissingGitConfigValueError(error: unknown): boolean {
  return gitCommandErrorText(error).replace(/[\r\n]+$/, "") === "";
}

export function resolveCurrentRepositoryFullName(repositoryPath: string = process.cwd()): string | null {
  validateRepositoryPath(repositoryPath);
  const gitBinary = requireGitBinary();

  try {
    const rawRemoteURL = runGitCommand(gitBinary, ["-C", repositoryPath, "remote", "get-url", "origin"]);
    const repositoryFullName = remoteRepositoryFullName(rawRemoteURL);
    if (!repositoryFullName) {
      const invalidRemoteMessage = invalidGitHubRemoteConfigurationMessage(rawRemoteURL);
      if (invalidRemoteMessage) {
        throw new Error(invalidRemoteMessage);
      }
    }

    return repositoryFullName;
  } catch (error) {
    if (isMissingRepositoryContextError(error)) {
      return null;
    }

    throw error;
  }
}

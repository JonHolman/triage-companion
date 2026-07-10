import os from "node:os";
import path from "node:path";

export function validatedHomeDirectory(): string {
  const homeDirectory = os.homedir();
  if (homeDirectory.trim().length === 0) {
    throw new Error("Home directory is invalid: must not be empty.");
  }
  if (homeDirectory.trim() !== homeDirectory) {
    throw new Error("Home directory is invalid: must not include surrounding whitespace.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(homeDirectory)) {
    throw new Error("Home directory is invalid: must not include control characters.");
  }

  return homeDirectory;
}

export function expandHomePath(candidate: string, homeDirectory?: string): string {
  if (candidate === "~") {
    return homeDirectory ?? validatedHomeDirectory();
  }

  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    const resolvedHomeDirectory = homeDirectory ?? validatedHomeDirectory();
    return path.join(resolvedHomeDirectory, candidate.slice(2));
  }

  return candidate;
}

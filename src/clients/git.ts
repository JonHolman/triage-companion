export { resolveGitBinary } from "../git/executor.ts";
import fs from "node:fs";
import path from "node:path";

import {
  findGitRepositories,
  normalizeRepositorySearchRoots,
  resolveGitRepositoryMetadataPath,
  resolveRepositorySearchRoots,
} from "../git/search.ts";
import {
  requireGitBinary,
  runGitCommand,
} from "../git/executor.ts";

interface GitStatusSummary {
  branch: string;
  changedCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  aheadCount: number;
  behindCount: number;
  statusLines: string[];
}

export interface DirtyRepository {
  path: string;
  name: string;
  branch: string;
  changedCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  aheadCount: number;
  behindCount: number;
  statusLines: string[];
  checkedAt: Date;
}

interface ListDirtyOptions {
  maxResults?: number;
  searchQuery?: string;
  searchRoots?: string[];
}

const PORCELAIN_STATUS_CODES = new Set([" ", "M", "T", "A", "D", "R", "C", "U"]);

function validateRepositoryPath(repoDir: string): void {
  if (/[\u0000-\u001F\u007F-\u009F]/.test(repoDir)) {
    throw new Error("Git repository path must not include control characters.");
  }
}

function normalizeSearchQuery(searchQuery: string | undefined): string | null {
  const normalized = searchQuery?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function repositoryNameOrPathMatches(repoDir: string, query: string): boolean {
  return path.basename(repoDir).toLowerCase().includes(query) || repoDir.toLowerCase().includes(query);
}

function repositoryBranchMatchesSearch(repoDir: string, query: string): boolean {
  const metadataPath = resolveGitRepositoryMetadataPath(repoDir);
  if (metadataPath === null) {
    throw new Error("Git repository metadata is missing.");
  }

  const headText = fs.readFileSync(path.join(metadataPath, "HEAD"), "utf-8").replace(/(?:\r?\n)+$/, "");
  if (/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(headText)) {
    return false;
  }
  if (!headText.startsWith("ref: refs/heads/")) {
    throw new Error("Git HEAD must reference a branch or object ID.");
  }

  const branch = headText.slice("ref: refs/heads/".length);
  if (branch.length === 0) {
    throw new Error("Git HEAD branch reference must include a branch name.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(branch)) {
    throw new Error("Git HEAD branch reference must not include control characters.");
  }
  if (branch.trim() !== branch) {
    throw new Error("Git HEAD branch reference must not include surrounding whitespace.");
  }

  return branch.toLowerCase().includes(query);
}

function validatePositiveIntegerOption(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

// Git octal-escapes every non-ASCII byte in quoted paths, so runs of octal
// escapes are decoded as UTF-8 to distinguish multi-byte filename characters,
// which are legitimate, from actual control characters.
function hasCStyleControlCharacterEscape(value: string): boolean {
  let index = 0;

  while (index < value.length) {
    if (value[index] !== "\\") {
      index += 1;
      continue;
    }

    const escaped = value[index + 1] ?? "";
    if (escaped === "\\" || escaped === "\"") {
      index += 2;
      continue;
    }

    if (/^[abfnrtv]$/.test(escaped)) {
      return true;
    }

    if (!/^[0-7]$/.test(escaped)) {
      index += 1;
      continue;
    }

    const bytes: number[] = [];
    while (value[index] === "\\") {
      const octalMatch = /^[0-7]{1,3}/.exec(value.slice(index + 1));
      if (!octalMatch) {
        break;
      }
      const code = Number.parseInt(octalMatch[0], 8);
      if (code > 0xff) {
        return true;
      }
      bytes.push(code);
      index += 1 + octalMatch[0].length;
    }

    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      if (bytes.some((byte) => byte <= 0x1f || (byte >= 0x7f && byte <= 0x9f))) {
        return true;
      }
      continue;
    }
    if (/[\u0000-\u001F\u007F-\u009F]/.test(decoded)) {
      return true;
    }
  }

  return false;
}

function filterRepositoriesForSearch(repoDirs: string[], query: string | null): string[] {
  if (query === null) {
    return repoDirs;
  }

  return repoDirs.filter(
    (repoDir) => repositoryNameOrPathMatches(repoDir, query) || repositoryBranchMatchesSearch(repoDir, query),
  );
}

function parseStatus(output: string): GitStatusSummary {
  const lines = output.split("\n");
  const branchLine = lines[0] ?? "";
  const statusLines = lines.slice(1);

  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of statusLines) {
    if (line.trim().length === 0) {
      throw new Error("Git status output must not include blank status entries.");
    }
    if (line.length < 4 || line[2] !== " ") {
      throw new Error("Git status output must separate status codes from paths.");
    }
    if (line.slice(3).trim().length === 0) {
      throw new Error("Git status output must include a changed path.");
    }
    const changedPathText = line.slice(3);
    if (/[\u0000-\u001F\u007F-\u009F]/.test(changedPathText) || hasCStyleControlCharacterEscape(changedPathText)) {
      throw new Error("Git status output paths must not include control characters.");
    }
    const xy = line.substring(0, 2);
    if (xy === "??") {
      untracked++;
      continue;
    }
    if (xy === "  ") {
      throw new Error("Git status output must include status codes for each changed entry.");
    }
    if (!PORCELAIN_STATUS_CODES.has(xy[0] ?? "") || !PORCELAIN_STATUS_CODES.has(xy[1] ?? "")) {
      throw new Error("Git status output must include valid porcelain status codes.");
    }

    if (xy[0] !== " ") {
      staged++;
    }

    if (xy[1] !== " ") {
      unstaged++;
    }
  }

  const branch = parseBranchName(branchLine);
  const tracking = parseTrackingCounts(branchLine);
  return {
    branch,
    changedCount: statusLines.length,
    stagedCount: staged,
    unstagedCount: unstaged,
    untrackedCount: untracked,
    aheadCount: tracking.ahead,
    behindCount: tracking.behind,
    statusLines,
  };
}

function parseBranchName(line: string): string {
  let branchText = line.replace(/[\r\n]+$/, "");
  if (!branchText.startsWith("## ")) {
    throw new Error("Git status output missing branch header.");
  }

  branchText = branchText.slice(3);
  if (branchText.startsWith("No commits yet on ")) {
    branchText = branchText.slice("No commits yet on ".length);
  }
  if (branchText.startsWith("Initial commit on ")) {
    branchText = branchText.slice("Initial commit on ".length);
  }
  branchText = branchText.split("...")[0] ?? "";
  branchText = branchText.split("[")[0] ?? "";
  if (!branchText) {
    throw new Error("Git status output missing branch header.");
  }
  if (branchText.trim() !== branchText) {
    throw new Error("Git status branch header must not include surrounding whitespace.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(branchText)) {
    throw new Error("Git status branch header must not include control characters.");
  }

  return branchText;
}

function parseTrackingCounts(line: string): { ahead: number; behind: number } {
  const bracketStart = line.indexOf("[");
  if (bracketStart === -1) {
    return { ahead: 0, behind: 0 };
  }

  if (!line.endsWith("]")) {
    throw new Error("Git status branch header must include valid ahead/behind counts.");
  }

  const trackingText = line.slice(bracketStart + 1, -1);
  if (trackingText.includes("[") || trackingText.includes("]")) {
    throw new Error("Git status branch header must include valid ahead/behind counts.");
  }

  if (trackingText === "gone") {
    return { ahead: 0, behind: 0 };
  }

  let ahead = 0;
  let behind = 0;
  const seen = new Set<string>();
  for (const part of trackingText.split(", ")) {
    const match = /^(ahead|behind) (\d+)$/.exec(part);
    if (!match) {
      throw new Error("Git status branch header must include valid ahead/behind counts.");
    }

    const label = match[1] ?? "";
    if (seen.has(label)) {
      throw new Error("Git status branch header must include valid ahead/behind counts.");
    }
    seen.add(label);

    const value = Number.parseInt(match[2] ?? "", 10);
    if (!Number.isSafeInteger(value)) {
      throw new Error("Git status branch header must include valid ahead/behind counts.");
    }

    if (label === "ahead") {
      ahead = value;
    } else {
      behind = value;
    }
  }

  return { ahead, behind };
}

export function listDirtyRepositories({
  maxResults = 300,
  searchQuery,
  searchRoots,
}: ListDirtyOptions = {}): DirtyRepository[] {
  const normalizedMax = validatePositiveIntegerOption(maxResults, "Git repository limit");
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
  const hasExplicitSearchRoots = searchRoots !== undefined;
  const normalizedSearchRoots = hasExplicitSearchRoots
    ? normalizeRepositorySearchRoots(searchRoots)
    : [];
  const roots = hasExplicitSearchRoots
    ? normalizedSearchRoots
    : resolveRepositorySearchRoots();

  const repoDirs = findGitRepositories(roots);
  if (repoDirs.length === 0) {
    return [];
  }

  for (const repoDir of repoDirs) {
    validateRepositoryPath(repoDir);
  }

  const checkedAt = new Date();
  const items: DirtyRepository[] = [];
  const candidateRepoDirs = filterRepositoriesForSearch(repoDirs, normalizedSearchQuery);
  if (candidateRepoDirs.length === 0) {
    return [];
  }

  const gitBinary = requireGitBinary();

  for (const repoDir of candidateRepoDirs) {
    const output = runGitCommand(gitBinary, [
      "-C",
      repoDir,
      "status",
      "--porcelain=v1",
      "-b",
      "--untracked-files=all",
    ]);

    const status = parseStatus(output);
    if (status.changedCount === 0) {
      continue;
    }

    items.push({
      path: repoDir,
      name: path.basename(repoDir),
      ...status,
      checkedAt,
    });
  }

  items.sort((a, b) => {
    if (a.changedCount !== b.changedCount) {
      return b.changedCount - a.changedCount;
    }

    return a.path.localeCompare(b.path);
  });

  return items.slice(0, normalizedMax);
}

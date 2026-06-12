/**
 * Git dirty-repository scanner — finds repos with uncommitted changes.
 *
 * Scans default search roots (or TRIAGE_COMPANION_GIT_SEARCH_ROOTS) for .git directories,
 * then runs `git status --porcelain=v1 -b` on each to detect dirty state.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PRUNED_DIRS = new Set([
  "node_modules",
  ".Trash",
  ".cache",
  ".npm",
  ".nvm",
  ".docker",
  ".gradle",
  "DerivedData",
]);

const DEFAULT_SEARCH_ROOTS = [
  "repos",
  "Developer",
  "src",
  "work",
  "code",
  "projects",
  "Documents",
  "Desktop",
  "Downloads",
];

// ── git executable resolution ──────────────────────────────────────

export function resolveGitBinary() {
  const configured = process.env.TRIAGE_COMPANION_GIT?.trim();
  if (configured) {
    try {
      fs.accessSync(configured, fs.constants.X_OK);
      return configured;
    } catch {
      return null;
    }
  }

  try {
    execFileSync("git", ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2000,
    });
    return "git";
  } catch {
    return null;
  }
}

export function hasGitBinary() {
  return resolveGitBinary() !== null;
}

function findGit() {
  const gitBin = resolveGitBinary();
  if (!gitBin) {
    throw new Error("Could not find git. Set TRIAGE_COMPANION_GIT or install git.");
  }
  return gitBin;
}

// ── repository discovery ───────────────────────────────────────────

function defaultSearchRoots() {
  const env = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS;
  if (env) {
    return env
      .split(":")
      .filter(Boolean)
      .filter((p) => {
        try { return fs.statSync(p).isDirectory(); } catch { return false; }
      });
  }

  const home = os.homedir();
  return DEFAULT_SEARCH_ROOTS
    .map((d) => path.join(home, d))
    .filter((p) => {
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    });
}

/** Recursively find .git directories or files, pruning known junk. */
function findGitDirs(roots) {
  const results = [];
  const visited = new Set();

  function isValidGitPath(fullPath) {
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) return true;
      if (stat.isFile()) {
        // For .git files (worktrees, submodules), verify it contains valid git metadata
        const content = fs.readFileSync(fullPath, "utf-8").trim();
        return content.startsWith("gitdir:") || content.length > 0;
      }
      return false;
    } catch {
      return false;
    }
  }

  function walk(dir, depth) {
    if (depth > 6) return; // safety
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;

      if (PRUNED_DIRS.has(name)) continue;

      const full = path.join(dir, name);

      if (name === ".git") {
        if (isValidGitPath(full)) {
          const repoDir = path.resolve(dir);
          if (!visited.has(repoDir)) {
            visited.add(repoDir);
            results.push(repoDir);
          }
        }
        // don't descend into .git (directory or file)
        continue;
      }

      // Only recurse into directories
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      }
    }
  }

  for (const root of roots) {
    walk(root, 0);
  }

  return results;
}

// ── status parsing ─────────────────────────────────────────────────

function parseStatus(output) {
  const lines = output.split("\n");
  const branchLine = lines[0] ?? "";
  const statusLines = lines.slice(1).filter((l) => l.length > 0);

  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of statusLines) {
    const xy = line.substring(0, 2);
    if (xy === "??") {
      untracked++;
      continue;
    }
    if (xy[0] !== " ") staged++;
    if (xy[1] !== " ") unstaged++;
  }

  const branchName = parseBranchName(branchLine);
  const ahead = countLabel("ahead", branchLine);
  const behind = countLabel("behind", branchLine);

  return {
    branch: branchName,
    changedCount: statusLines.length,
    stagedCount: staged,
    unstagedCount: unstaged,
    untrackedCount: untracked,
    aheadCount: ahead,
    behindCount: behind,
    statusLines: statusLines.slice(0, 40),
  };
}

function parseBranchName(line) {
  let trimmed = line.startsWith("## ") ? line.slice(3) : line;
  trimmed = trimmed.split("...")[0];
  trimmed = trimmed.split("[")[0].trim();
  return trimmed || "unknown";
}

function countLabel(label, text) {
  const re = new RegExp(`${label} (\\d+)`);
  const m = text.match(re);
  return m ? parseInt(m[1], 10) : 0;
}

// ── public API ─────────────────────────────────────────────────────

/**
 * List git repositories with uncommitted changes.
 * Returns Array of dirty-repo objects.
 */
export function listDirtyRepositories({ maxResults = 300, searchRoots = [] } = {}) {
  const gitBin = findGit();
  const roots = searchRoots.length > 0 ? searchRoots : defaultSearchRoots();
  if (roots.length === 0) return [];

  const repoDirs = findGitDirs(roots);
  const checkedAt = new Date();
  const items = [];

  for (const dir of repoDirs) {
    try {
      const output = execFileSync(gitBin, ["-C", dir, "status", "--porcelain=v1", "-b"], {
        encoding: "utf-8",
        timeout: 5000,
      });

      const status = parseStatus(output);
      if (status.changedCount === 0) continue;

      items.push({
        path: dir,
        name: path.basename(dir),
        ...status,
        checkedAt,
      });
    } catch {
      // skip repos that fail
    }
  }

  items.sort((a, b) => {
    if (a.changedCount !== b.changedCount) return b.changedCount - a.changedCount;
    return a.path.localeCompare(b.path);
  });

  return items.slice(0, maxResults);
}

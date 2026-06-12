/**
 * GitHub API client — notifications, mark-read, open PR discovery, and
 * Dependabot security alerts.
 *
 * Token resolution order:
 *   1. Credential store  (Triage Companion-GitHub / notifications-token)
 *   2. Environment variable  GITHUB_TOKEN
 */

import * as creds from "../credential-store.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVICE = "Triage Companion-GitHub";
const ACCOUNT = "notifications-token";
const API_VERSION = "2022-11-28";
const USER_AGENT = "triage-companion";
const DEFAULT_IGNORED_PR_BRANCHES = new Set(["main", "master", "production"]);
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

// ── token helpers ──────────────────────────────────────────────────

function storedToken() {
  const t = creds.read(SERVICE, ACCOUNT)?.trim();
  return t || null;
}

function envToken() {
  const t = process.env.GITHUB_TOKEN?.trim();
  return t || null;
}

function resolveToken() {
  return storedToken() ?? envToken();
}

export function hasToken() {
  return resolveToken() !== null;
}

export function saveToken(token) {
  creds.save(SERVICE, ACCOUNT, token.trim());
}

// ── internal fetch helper ──────────────────────────────────────────

async function ghFetch(url, token, { method = "GET" } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  return res;
}

// ── Link header pagination ─────────────────────────────────────────

function nextURL(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const pieces = part.split(";").map((s) => s.trim());
    if (pieces.some((p) => p === 'rel="next"')) {
      const urlPart = pieces[0];
      if (urlPart?.startsWith("<") && urlPart?.endsWith(">")) {
        return urlPart.slice(1, -1);
      }
    }
  }
  return null;
}

function findGit() {
  const configured = process.env.TRIAGE_COMPANION_GIT?.trim();
  if (configured) {
    fs.accessSync(configured, fs.constants.X_OK);
    return configured;
  }

  try {
    runGit("git", ["--version"], { timeout: 2000 });
    return "git";
  } catch {
    throw new Error("Could not find git. Set TRIAGE_COMPANION_GIT or install git.");
  }
}

function defaultSearchRoots() {
  const configured = process.env.TRIAGE_COMPANION_GIT_SEARCH_ROOTS?.trim();
  if (configured) {
    return configured
      .split(":")
      .filter(Boolean)
      .filter((dir) => {
        try {
          return fs.statSync(dir).isDirectory();
        } catch {
          return false;
        }
      });
  }

  const home = os.homedir();
  return DEFAULT_SEARCH_ROOTS.map((name) => path.join(home, name)).filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

function findGitRepos(roots) {
  const repos = [];
  const seen = new Set();

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
    if (depth > 6) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (PRUNED_DIRS.has(name)) continue;

      const fullPath = path.join(dir, name);
      if (name === ".git") {
        if (isValidGitPath(fullPath)) {
          const repoPath = path.resolve(dir);
          if (!seen.has(repoPath)) {
            seen.add(repoPath);
            repos.push(repoPath);
          }
        }
        continue;
      }

      // Only recurse into directories
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      }
    }
  }

  for (const root of roots) {
    walk(root, 0);
  }

  return repos;
}

function runGit(gitBin, args, { cwd, timeout = 5000 } = {}) {
  return execFileSync(gitBin, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  }).trimEnd();
}

function remoteRepositoryURL(remoteURL) {
  const value = remoteURL.trim();
  if (value.startsWith("git@github.com:")) {
    return `https://github.com/${stripGitSuffix(value.slice("git@github.com:".length))}`;
  }
  if (value.startsWith("ssh://git@github.com/")) {
    return `https://github.com/${stripGitSuffix(value.slice("ssh://git@github.com/".length))}`;
  }
  if (value.startsWith("https://github.com/")) {
    return stripGitSuffix(value);
  }
  return null;
}

function stripGitSuffix(value) {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function remoteRefs(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([sha, ref]) => ({ sha, ref }));
}

function branchName(ref) {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
}

function pullRequestNumber(ref, suffix) {
  if (!ref.startsWith("refs/pull/") || !ref.endsWith(suffix)) return null;
  const numberText = ref.slice("refs/pull/".length, -suffix.length);
  return Number.parseInt(numberText, 10) || null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function defaultAuthorPattern(gitBin) {
  const values = [];

  for (const key of ["user.name", "user.email"]) {
    try {
      const value = runGit(gitBin, ["config", "--global", "--get", key], { timeout: 2000 }).trim();
      if (value) values.push(escapeRegExp(value));
    } catch {
      // Keep collecting whatever identity information exists.
    }
  }

  if (values.length === 0) return null;
  return new RegExp(values.join("|"), "i");
}

function configuredIgnoredBranches() {
  const raw = process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES?.trim();
  if (!raw) return DEFAULT_IGNORED_PR_BRANCHES;
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

// ── public API ─────────────────────────────────────────────────────

/**
 * Fetch GitHub notifications.
 * Returns Array of notification objects.
 */
export async function listNotifications({
  maxResults = 200,
  includeRead = false,
} = {}) {
  const token = resolveToken();
  if (!token) throw new Error("GitHub token not configured. Run: triage-companion github token <token>");

  const perPage = Math.min(Math.max(maxResults, 1), 100);
  const params = new URLSearchParams({
    all: includeRead ? "true" : "false",
    participating: "false",
    per_page: String(perPage),
  });

  let url = `https://api.github.com/notifications?${params}`;
  const raw = [];

  while (raw.length < maxResults) {
    const res = await ghFetch(url, token);

    if (res.status === 403) {
      const sso = res.headers.get("x-github-sso");
      if (sso?.includes("required")) {
        const urlMatch = sso.match(/url=([^;]+)/);
        throw new Error(
          `SSO authorization required. Visit: ${urlMatch?.[1] || "(check GitHub settings)"}`
        );
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`GitHub API HTTP ${res.status}: ${body.message || "unknown error"}`);
    }

    const page = await res.json();
    raw.push(...page);

    if (raw.length >= maxResults) break;
    const next = nextURL(res.headers.get("link"));
    if (!next) break;
    url = next;
  }

  const limited = raw.slice(0, maxResults);

  // Enrich PR notifications with state (best-effort, parallel, batched)
  const prApiURLs = limited
    .filter((n) => n.subject?.type === "PullRequest" && n.subject?.url)
    .map((n) => ({ id: n.id, apiURL: n.subject.url }));

  const prDetails = {};
  const BATCH = 8;
  for (let i = 0; i < prApiURLs.length; i += BATCH) {
    const batch = prApiURLs.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async ({ id, apiURL }) => {
        const r = await ghFetch(apiURL, token);
        if (!r.ok) return null;
        const d = await r.json();
        return { id, state: d.state, merged: d.merged, author: d.user?.login };
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        prDetails[r.value.id] = r.value;
      }
    }
  }

  return limited.map((n) => {
    const pr = prDetails[n.id];
    return {
      id: n.id,
      repositoryFullName: n.repository?.full_name ?? "",
      repositoryURL: n.repository?.html_url ?? "",
      subjectTitle: n.subject?.title ?? "",
      subjectType: n.subject?.type ?? "",
      subjectState: pr?.state ?? null,
      subjectMerged: pr?.merged ?? null,
      subjectAuthorLogin: pr?.author ?? null,
      reason: n.reason ?? "",
      updatedAt: n.updated_at ? new Date(n.updated_at) : null,
      isUnread: n.unread,
      webURL: webURL(n) ?? n.repository?.html_url,
    };
  }).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function webURL(notification) {
  const subject = notification.subject;
  const repoURL = notification.repository?.html_url;
  if (!subject) return null;

  if (subject.type === "RepositoryDependabotAlertsThread") {
    return `${repoURL}/security/dependabot`;
  }

  if (!subject.url) return null;
  try {
    const u = new URL(subject.url);
    const parts = u.pathname.split("/");
    // /repos/{owner}/{repo}/{kind}/{id}
    if (parts.length >= 6 && parts[1] === "repos") {
      const owner = parts[2];
      const repo = parts[3];
      const kind = parts[4];
      const id = parts[5];
      if (kind === "issues") return `https://github.com/${owner}/${repo}/issues/${id}`;
      if (kind === "pulls") return `https://github.com/${owner}/${repo}/pull/${id}`;
      if (kind === "commits") return `https://github.com/${owner}/${repo}/commit/${id}`;
    }
  } catch {
    // ignore
  }
  return repoURL;
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(notificationId) {
  const token = resolveToken();
  if (!token) throw new Error("GitHub token not configured.");

  const res = await ghFetch(
    `https://api.github.com/notifications/threads/${notificationId}`,
    token,
    { method: "PATCH" }
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`GitHub API HTTP ${res.status}: ${body.message || "unknown error"}`);
  }
}

export function listMyOpenPullRequests({
  repositoryPaths = [],
  searchRoots = [],
  authorRegex = null,
} = {}) {
  const gitBin = findGit();
  const roots = searchRoots.length > 0 ? searchRoots : defaultSearchRoots();
  const repos = repositoryPaths.length > 0 ? repositoryPaths : findGitRepos(roots);
  const ignoredBranches = configuredIgnoredBranches();
  const authorPattern =
    authorRegex ? new RegExp(authorRegex, "i") : defaultAuthorPattern(gitBin);

  if (!authorPattern) {
    throw new Error(
      "Could not determine your git author identity. Set TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX or pass --author-regex."
    );
  }

  const items = [];

  for (const repoPath of repos) {
    let remoteURL;
    try {
      remoteURL = remoteRepositoryURL(
        runGit(gitBin, ["-C", repoPath, "remote", "get-url", "origin"])
      );
    } catch {
      continue;
    }

    if (!remoteURL) continue;

    let branchRefs;
    let prRefs;
    try {
      branchRefs = remoteRefs(
        runGit(gitBin, ["-C", repoPath, "ls-remote", "origin", "refs/heads/*"], { timeout: 30000 })
      );
      prRefs = remoteRefs(
        runGit(
          gitBin,
          ["-C", repoPath, "ls-remote", "origin", "refs/pull/*/head", "refs/pull/*/merge"],
          { timeout: 30000 }
        )
      );
    } catch {
      continue;
    }

    if (prRefs.length === 0) continue;

    const openPullRequestNumbers = new Set(
      prRefs.map((ref) => pullRequestNumber(ref.ref, "/merge")).filter((value) => value !== null)
    );
    const headRefsBySha = new Map();
    for (const ref of prRefs.filter((item) => item.ref.endsWith("/head"))) {
      const itemsForSha = headRefsBySha.get(ref.sha) ?? [];
      itemsForSha.push(ref);
      headRefsBySha.set(ref.sha, itemsForSha);
    }

    for (const branchRef of branchRefs) {
      const branch = branchName(branchRef.ref);
      if (!branch || ignoredBranches.has(branch)) continue;

      const matchingHeadRefs = headRefsBySha.get(branchRef.sha);
      if (!matchingHeadRefs?.length) continue;

      const prNumber = matchingHeadRefs
        .map((ref) => pullRequestNumber(ref.ref, "/head"))
        .find((value) => value !== null && openPullRequestNumbers.has(value));
      if (!prNumber) continue;

      let author = "";
      try {
        try {
          runGit(gitBin, ["-C", repoPath, "cat-file", "-e", branchRef.sha], { timeout: 5000 });
        } catch {
          runGit(gitBin, ["-C", repoPath, "fetch", "origin", branchRef.sha, "--depth=1"], {
            timeout: 20000,
          });
        }
        author = runGit(gitBin, ["-C", repoPath, "log", "-1", "--format=%an %ae", branchRef.sha], {
          timeout: 5000,
        }).trim();
      } catch {
        continue;
      }

      if (!authorPattern.test(author)) continue;

      items.push({
        repositoryPath: repoPath,
        repositoryName: path.basename(repoPath),
        branch,
        pullRequestNumber: prNumber,
        url: `${remoteURL}/pull/${prNumber}`,
        author,
        headSHA: branchRef.sha,
      });
    }
  }

  return items.sort((a, b) => {
    if (a.repositoryName !== b.repositoryName) {
      return a.repositoryName.localeCompare(b.repositoryName);
    }
    return a.branch.localeCompare(b.branch);
  });
}

/**
 * List Dependabot security alerts for given repository full names.
 */
export async function listSecurityAlerts(repositoryFullNames, { maxPerRepo = 100 } = {}) {
  const token = resolveToken();
  if (!token) throw new Error("GitHub token not configured.");

  const alerts = [];
  const BATCH = 6;

  for (let i = 0; i < repositoryFullNames.length; i += BATCH) {
    const batch = repositoryFullNames.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (repoName) => {
        const url = `https://api.github.com/repos/${repoName}/dependabot/alerts?state=open&per_page=${Math.min(maxPerRepo, 100)}`;
        const res = await ghFetch(url, token);
        if (!res.ok) return [];
        const data = await res.json();
        return data.map((alert) => ({
          repositoryFullName: repoName,
          ghsaID: alert.security_advisory?.ghsa_id ?? "",
          packageName:
            alert.dependency?.package?.name ??
            alert.security_vulnerability?.package?.name ??
            "unknown",
          severity:
            alert.security_vulnerability?.severity ??
            alert.security_advisory?.severity ??
            "unknown",
          state: alert.state,
          vulnerableRange: alert.security_vulnerability?.vulnerable_version_range ?? null,
          patchedVersion: alert.security_vulnerability?.first_patched_version?.identifier ?? null,
          manifestPath: alert.dependency?.manifest_path ?? null,
          url: alert.html_url ?? "",
          summary: alert.security_advisory?.summary ?? "",
        }));
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") alerts.push(...r.value);
    }
  }

  const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
  return alerts.sort(
    (a, b) =>
      (RANK[b.severity?.toLowerCase()] ?? 0) - (RANK[a.severity?.toLowerCase()] ?? 0) ||
      a.ghsaID.localeCompare(b.ghsaID) ||
      a.repositoryFullName.localeCompare(b.repositoryFullName)
  );
}

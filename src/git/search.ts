import fs from "node:fs";
import path from "node:path";
import { resolveSearchRoots } from "../config.ts";
import { inlineErrorText } from "../text.ts";
import { expandHomePath } from "../config-path.ts";
import { validateGitSearchRootEntries } from "../config-model.ts";

const PRUNED_DIRS = new Set<string>([
  "node_modules",
  ".Trash",
  ".cache",
  ".npm",
  ".nvm",
  ".docker",
  ".gradle",
  "DerivedData",
  "review-artifacts",
]);

export interface GitDiscoveryOptions {
  maxDepth?: number;
}

// A path that does not exist (or has a non-directory component) is a normal
// "not a repository" outcome. Any other failure, such as a permission error,
// must fail discovery instead of silently skipping the repository.
function isPathAbsenceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function metadataReadError(metadataPath: string, error: unknown): Error {
  return new Error(`Could not read Git repository metadata ${inlineErrorText(metadataPath)}.`, {
    cause: error,
  });
}

function hasGitHeadFile(gitDirectory: string): boolean {
  const headPath = path.join(gitDirectory, "HEAD");
  try {
    return fs.statSync(headPath).isFile();
  } catch (error) {
    if (isPathAbsenceError(error)) {
      return false;
    }
    throw metadataReadError(headPath, error);
  }
}

function resolvedGitDirectory(fullPath: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch (error) {
    if (isPathAbsenceError(error)) {
      return null;
    }
    throw metadataReadError(fullPath, error);
  }

  if (stat.isDirectory()) {
    return hasGitHeadFile(fullPath) ? fullPath : null;
  }
  if (!stat.isFile()) {
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(fullPath, "utf-8");
  } catch (error) {
    throw metadataReadError(fullPath, error);
  }

  content = content.replace(/(?:\r?\n)+$/, "");
  if (!content.startsWith("gitdir: ")) {
    return null;
  }

  const rawGitDirectory = content.slice("gitdir: ".length);
  if (!rawGitDirectory) {
    return null;
  }

  const gitDirectory = path.isAbsolute(rawGitDirectory)
    ? rawGitDirectory
    : path.resolve(path.dirname(fullPath), rawGitDirectory);
  return hasGitHeadFile(gitDirectory) ? gitDirectory : null;
}

export function isGitRepositoryMetadataPath(fullPath: string): boolean {
  return resolvedGitDirectory(fullPath) !== null;
}

export function resolveGitRepositoryMetadataPath(repositoryPath: string): string | null {
  return resolvedGitDirectory(path.join(repositoryPath, ".git"));
}

function canonicalPath(fullPath: string): string {
  try {
    return fs.realpathSync(fullPath);
  } catch (error) {
    throw new Error(`Could not resolve Git search path ${inlineErrorText(fullPath)}.`, {
      cause: error,
    });
  }
}

function isTraversableDirectory(fullPath: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) {
    return true;
  }

  if (!entry.isSymbolicLink()) {
    return false;
  }

  try {
    return fs.statSync(fullPath).isDirectory();
  } catch (error) {
    // A broken symlink or a symlink loop is skipped like any other
    // non-directory entry; other failures must fail discovery.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || isPathAbsenceError(error)) {
      return false;
    }
    throw new Error(`Could not read Git search directory ${inlineErrorText(fullPath)}.`, {
      cause: error,
    });
  }
}

function walkGitRoots(
  root: string,
  maxDepth: number,
  visitedDirectories: Set<string>,
  visited: Set<string>,
  out: string[],
  depth: number,
): void {
  if (depth > maxDepth) return;

  const directoryKey = canonicalPath(root);
  if (visitedDirectories.has(directoryKey)) {
    return;
  }
  visitedDirectories.add(directoryKey);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Could not read Git search directory ${inlineErrorText(root)}.`, {
      cause: error,
    });
  }

  for (const entry of entries) {
    if (PRUNED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(root, entry.name);
    if (entry.name === ".git") {
      if (isGitRepositoryMetadataPath(fullPath)) {
        const repoDir = path.resolve(root);
        const repositoryKey = canonicalPath(repoDir);
        if (!visited.has(repositoryKey)) {
          visited.add(repositoryKey);
          out.push(repoDir);
        }
      }
      continue;
    }

    if (isTraversableDirectory(fullPath, entry)) {
      walkGitRoots(fullPath, maxDepth, visitedDirectories, visited, out, depth + 1);
    }
  }
}

export function findGitRepositories(
  searchRoots: string[],
  { maxDepth = 6 }: GitDiscoveryOptions = {},
): string[] {
  const repos: string[] = [];
  const visited = new Set<string>();

  for (const root of searchRoots) {
    const visitedDirectories = new Set<string>();
    walkGitRoots(root, maxDepth, visitedDirectories, visited, repos, 0);
  }

  return repos;
}

export function resolveRepositorySearchRoots(rawRoots?: string): string[] {
  return resolveSearchRoots(rawRoots);
}

export function normalizeRepositorySearchRoots(searchRoots: readonly string[]): string[] {
  if (searchRoots.length === 0) {
    return [];
  }

  if (searchRoots.some((root) => root.trim().length === 0)) {
    throw new Error("Git search roots must not contain blank entries.");
  }
  const validation = validateGitSearchRootEntries(searchRoots);
  if (validation !== null) {
    throw new Error(`Git search roots ${validation}.`);
  }

  return searchRoots
    .map((root) => expandHomePath(root))
    .filter((root) => {
      try {
        return fs.statSync(root).isDirectory();
      } catch (error) {
        if (isPathAbsenceError(error)) {
          return false;
        }
        throw new Error(`Could not read Git search root ${inlineErrorText(root)}.`, {
          cause: error,
        });
      }
    });
}

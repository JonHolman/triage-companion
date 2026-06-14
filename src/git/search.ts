import fs from "node:fs";
import path from "node:path";
import { resolveSearchRoots } from "../config.ts";
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

function inlinePathText(text: string): string {
  const normalizedLineBreaks = text.replace(/\r\n?|\n/g, ", ");
  return normalizedLineBreaks.replace(/[\u0000-\u001F\u007F-\u009F]/g, (character) => {
    switch (character) {
      case "\t":
        return "\\t";
      default:
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    }
  });
}

export interface GitDiscoveryOptions {
  maxDepth?: number;
}

function hasGitHeadFile(gitDirectory: string): boolean {
  try {
    return fs.statSync(path.join(gitDirectory, "HEAD")).isFile();
  } catch {
    return false;
  }
}

function resolvedGitDirectory(fullPath: string): string | null {
  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      return hasGitHeadFile(fullPath) ? fullPath : null;
    }
    if (stat.isFile()) {
      const content = fs.readFileSync(fullPath, "utf-8").replace(/(?:\r?\n)+$/, "");
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
    return null;
  } catch {
    return null;
  }
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
  } catch {
    return path.resolve(fullPath);
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
  } catch {
    return false;
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
    throw new Error(`Could not read Git search directory ${inlinePathText(root)}.`, {
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
    .filter(Boolean)
    .filter((root) => {
      try {
        return fs.statSync(root).isDirectory();
      } catch {
        return false;
      }
    });
}

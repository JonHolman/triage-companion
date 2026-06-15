import fs from "node:fs";
import path from "node:path";

import {
  isGitRepositoryMetadataPath,
} from "../git/search.ts";

export function validateExplicitRepositoryPaths(repositoryPaths: readonly string[]): string[] {
  const uniquePaths: string[] = [];
  const seen = new Set<string>();

  for (const [index, repositoryPath] of repositoryPaths.entries()) {
    const pathLabel = `Repository path #${index + 1}`;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(repositoryPath);
    } catch {
      throw new Error(`${pathLabel} does not exist.`);
    }

    if (!stat.isDirectory()) {
      throw new Error(`${pathLabel} is not a directory.`);
    }

    if (!isGitRepositoryMetadataPath(path.join(repositoryPath, ".git"))) {
      throw new Error(`${pathLabel} is not a Git repository.`);
    }

    const key = (() => {
      try {
        return fs.realpathSync(repositoryPath);
      } catch {
        return path.resolve(repositoryPath);
      }
    })();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniquePaths.push(repositoryPath);
  }

  return uniquePaths;
}

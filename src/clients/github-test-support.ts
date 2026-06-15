import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe } from "node:test";

import { resetCache } from "../credential-store.ts";

export const describeWithExecutableWrapper = process.platform === "win32" ? describe.skip : describe;

export interface GitHubRepositoryDiscoveryTestContext {
  readonly defaultGit: string;
  readonly repoDir: string;
  readonly submoduleRepoDir: string;
  readonly testDir: string;
  readonly worktreeRepoDir: string;
}

export function writeFakeGitScript(scriptPath: string, body: string): void {
  const normalizedBody = body.startsWith("#!/bin/sh\n")
    ? body.slice("#!/bin/sh\n".length)
    : body;
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo 'git version 2.0.0'
  exit 0
fi
${normalizedBody}`,
  );
}

export function writeHeadFile(gitDirectory: string, branch: string = "main"): void {
  fs.mkdirSync(gitDirectory, { recursive: true });
  fs.writeFileSync(path.join(gitDirectory, "HEAD"), `ref: refs/heads/${branch}\n`);
}

export function setupGitHubRepositoryDiscoveryTest(): GitHubRepositoryDiscoveryTestContext {
  let testDir: string;
  let repoDir: string;
  let worktreeRepoDir: string;
  let submoduleRepoDir: string;
  let worktreeGitDir: string;
  let submoduleGitDir: string;
  let defaultGit: string;
  let previousGit: string | undefined;
  let previousConfigDir: string | undefined;
  let previousToken: string | undefined;
  let previousHome: string | undefined;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-test-"));
    repoDir = path.join(testDir, "normal-repo");
    worktreeRepoDir = path.join(testDir, "worktree-repo");
    submoduleRepoDir = path.join(testDir, "submodule-repo");
    worktreeGitDir = path.join(testDir, "metadata", "worktrees", "branch1");
    submoduleGitDir = path.join(testDir, "parent", ".git", "modules", "submodule");
    previousGit = process.env.TRIAGE_COMPANION_GIT;
    previousConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
    previousToken = process.env.GITHUB_TOKEN;
    previousHome = process.env.HOME;
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    resetCache();

    defaultGit = path.join(testDir, "git");
    writeFakeGitScript(defaultGit, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(defaultGit, 0o755);
    process.env.TRIAGE_COMPANION_GIT = defaultGit;

    writeHeadFile(path.join(repoDir, ".git"));
    fs.writeFileSync(path.join(repoDir, "test.txt"), "test content");

    writeHeadFile(worktreeGitDir, "worktree");
    fs.mkdirSync(worktreeRepoDir);
    fs.writeFileSync(
      path.join(worktreeRepoDir, ".git"),
      `gitdir: ${worktreeGitDir}\n`,
    );
    fs.writeFileSync(path.join(worktreeRepoDir, "test.txt"), "worktree content");

    writeHeadFile(submoduleGitDir, "submodule");
    fs.mkdirSync(submoduleRepoDir);
    fs.writeFileSync(
      path.join(submoduleRepoDir, ".git"),
      "gitdir: ../parent/.git/modules/submodule\n",
    );
    fs.writeFileSync(path.join(submoduleRepoDir, "test.txt"), "submodule content");
  });

  beforeEach(() => {
    process.env.TRIAGE_COMPANION_GIT = defaultGit;
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    resetCache();
  });

  afterEach(() => {
    process.env.TRIAGE_COMPANION_GIT = defaultGit;
    process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
    delete process.env.GITHUB_TOKEN;
    delete process.env.TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES;
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    resetCache();
  });

  after(() => {
    resetCache();

    if (previousGit === undefined) {
      delete process.env.TRIAGE_COMPANION_GIT;
    } else {
      process.env.TRIAGE_COMPANION_GIT = previousGit;
    }

    if (previousConfigDir === undefined) {
      delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
    } else {
      process.env.TRIAGE_COMPANION_CONFIG_DIR = previousConfigDir;
    }

    if (previousToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousToken;
    }

    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  return {
    get defaultGit() {
      return defaultGit;
    },
    get repoDir() {
      return repoDir;
    },
    get submoduleRepoDir() {
      return submoduleRepoDir;
    },
    get testDir() {
      return testDir;
    },
    get worktreeRepoDir() {
      return worktreeRepoDir;
    },
  };
}

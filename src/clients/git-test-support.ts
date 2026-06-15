import assert from "node:assert/strict";
import { describe } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listDirtyRepositories } from "./git.ts";

export const describeWithExecutableWrapper = process.platform === "win32" ? describe.skip : describe;

export function writeFakeGitScript(scriptPath: string, body: string): void {
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo 'git version 2.0.0'
  exit 0
fi
${body}`,
  );
  fs.chmodSync(scriptPath, 0o755);
}

export function writeHeadFile(gitDirectory: string, branch: string = "main"): void {
  fs.mkdirSync(gitDirectory, { recursive: true });
  fs.writeFileSync(path.join(gitDirectory, "HEAD"), `ref: refs/heads/${branch}\n`);
}

export function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

export function statusScriptFor(repoName: string, status: string): string {
  return `repo=""
if [ "$1" = "-C" ]; then
  repo="$2"
  shift 2
fi

if [ "$1" = "status" ]; then
  case "$(basename "$repo")" in
    ${repoName})
      cat <<'STATUS_EOF'
${status}
STATUS_EOF
      ;;
  esac
fi
`;
}

export function withFakeGit<T>(
  prefix: string,
  body: string,
  run: (root: string) => T,
): T {
  const previousGit = process.env.TRIAGE_COMPANION_GIT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const fakeGit = path.join(root, "git");
  writeFakeGitScript(fakeGit, body);
  process.env.TRIAGE_COMPANION_GIT = fakeGit;

  try {
    return run(root);
  } finally {
    restoreEnvValue("TRIAGE_COMPANION_GIT", previousGit);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export function assertStatusRejected(
  prefix: string,
  status: string,
  expectedError: RegExp,
): void {
  withFakeGit(prefix, statusScriptFor("malformed-repo", status), (root) => {
    const malformedRepo = path.join(root, "malformed-repo");
    writeHeadFile(path.join(malformedRepo, ".git"));

    assert.throws(
      () => listDirtyRepositories({ maxResults: 10, searchRoots: [root] }),
      expectedError,
    );
  });
}

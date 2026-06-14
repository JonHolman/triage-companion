import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { ENV } from "../config.ts";
import { requireGitBinary, resolveGitBinary, runGitCommand } from "./executor.ts";

let originalGitBinary: string | undefined;
let originalHome: string | undefined;
let testDir = "";

beforeEach(() => {
  originalGitBinary = process.env[ENV.GIT_BINARY];
  originalHome = process.env.HOME;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-executor-"));
  delete process.env[ENV.GIT_BINARY];
});

afterEach(() => {
  if (originalGitBinary === undefined) {
    delete process.env[ENV.GIT_BINARY];
  } else {
    process.env[ENV.GIT_BINARY] = originalGitBinary;
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  fs.rmSync(testDir, { force: true, recursive: true });
});

describe("git executor", () => {
  test("rejects configured git paths that point to directories", () => {
    const fakeDirectory = path.join(testDir, "fake-git");
    fs.mkdirSync(fakeDirectory);
    process.env[ENV.GIT_BINARY] = fakeDirectory;

    assert.equal(resolveGitBinary(), null);
    assert.throws(
      () => requireGitBinary(),
      /TRIAGE_COMPANION_GIT is invalid: must point to an executable path/,
    );
  });

  test("rejects configured executables that are not git binaries", () => {
    const fakeGit = path.join(testDir, "fake-git");
    fs.writeFileSync(fakeGit, "#!/bin/sh\necho not-git\n", { mode: 0o755 });
    process.env[ENV.GIT_BINARY] = fakeGit;

    assert.equal(resolveGitBinary(), null);
    assert.throws(
      () => requireGitBinary(),
      /TRIAGE_COMPANION_GIT is invalid: must point to a git executable/,
    );
  });

  test("rejects configured git paths with surrounding whitespace", () => {
    const fakeGit = path.join(testDir, "fake-git");
    fs.writeFileSync(fakeGit, "#!/bin/sh\necho 'git version 2.0.0'\n", {
      mode: 0o755,
    });
    process.env[ENV.GIT_BINARY] = ` ${fakeGit} `;

    assert.equal(resolveGitBinary(), null);
    assert.throws(
      () => requireGitBinary(),
      /TRIAGE_COMPANION_GIT is invalid: must not include surrounding whitespace/,
    );
  });

  test("rejects configured git paths whose version output has surrounding whitespace", () => {
    const fakeGit = path.join(testDir, "fake-git");
    fs.writeFileSync(fakeGit, "#!/bin/sh\necho ' git version 2.0.0'\n", {
      mode: 0o755,
    });
    process.env[ENV.GIT_BINARY] = fakeGit;

    assert.equal(resolveGitBinary(), null);
    assert.throws(
      () => requireGitBinary(),
      /TRIAGE_COMPANION_GIT is invalid: must point to a git executable/,
    );
  });

  test("accepts configured git binaries when the version probe takes longer than two seconds", () => {
    const fakeGit = path.join(testDir, "fake-git");
    fs.writeFileSync(fakeGit, "#!/bin/sh\nsleep 3\necho 'git version 2.0.0'\n", {
      mode: 0o755,
    });
    process.env[ENV.GIT_BINARY] = fakeGit;

    assert.equal(requireGitBinary(), fakeGit);
  });

  test("rejects home-relative configured git paths when HOME has control characters", () => {
    const badHome = `${fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-home-"))}\tbad`;
    fs.mkdirSync(badHome, { recursive: true });
    const fakeGit = path.join(badHome, "fake-git");
    fs.writeFileSync(fakeGit, "#!/bin/sh\necho 'git version 2.0.0'\n", {
      mode: 0o755,
    });
    process.env.HOME = badHome;
    process.env[ENV.GIT_BINARY] = "~/fake-git";

    assert.equal(resolveGitBinary(), null);
    assert.throws(
      () => requireGitBinary(),
      /Home directory is invalid: must not include control characters/,
    );
  });

  test("accepts absolute configured git paths without requiring a valid HOME", () => {
    const fakeGit = path.join(testDir, "fake-git");
    fs.writeFileSync(fakeGit, "#!/bin/sh\necho 'git version 2.0.0'\n", {
      mode: 0o755,
    });
    process.env.HOME = `${fs.mkdtempSync(path.join(os.tmpdir(), "triage-git-home-"))}\tbad`;
    process.env[ENV.GIT_BINARY] = fakeGit;

    assert.equal(resolveGitBinary(), fakeGit);
    assert.equal(requireGitBinary(), fakeGit);
  });

  test("preserves trailing spaces in git command output while stripping trailing newlines", () => {
    const fakeGit = path.join(testDir, "fake-git");
    fs.writeFileSync(
      fakeGit,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\necho 'git version 2.0.0'\nelse\nprintf 'value   \\n\\n'\nfi\n",
      { mode: 0o755 },
    );

    assert.equal(runGitCommand(fakeGit, ["config", "--get", "user.name"]), "value   ");
  });
});

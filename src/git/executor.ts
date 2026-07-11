import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { ENV } from "../config.ts";
import { expandHomePath } from "../config-path.ts";

const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 5000;
const GIT_VERSION_CHECK_TIMEOUT_MS = DEFAULT_GIT_COMMAND_TIMEOUT_MS;
const DEFAULT_GIT_COMMAND_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function configuredGitBinaryValidationError(binary: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(binary);
  } catch {
    return "must point to an executable path";
  }

  if (!stat.isFile()) {
    return "must point to an executable path";
  }

  try {
    fs.accessSync(binary, fs.constants.X_OK);
  } catch {
    return "must point to an executable path";
  }

  return isGitBinary(binary) ? null : "must point to a git executable";
}

function isGitBinary(binary: string): boolean {
  try {
    const output = execFileSync(binary, ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_VERSION_CHECK_TIMEOUT_MS,
    }).replace(/[\r\n]+$/, "");
    return output.trim() === output && /^git version \d/i.test(output);
  } catch {
    return false;
  }
}

export interface GitCommandOptions {
  cwd?: string;
  timeout?: number;
}

export function resolveGitBinary(): string | null {
  try {
    return requireGitBinary();
  } catch {
    return null;
  }
}

export function requireGitBinary(): string {
  const configured = process.env[ENV.GIT_BINARY];
  if (configured === undefined || configured.trim().length === 0) {
    if (!isGitBinary("git")) {
      throw new Error("Could not find git. Set TRIAGE_COMPANION_GIT or install git.");
    }

    return "git";
  }

  if (configured.trim() !== configured) {
    throw new Error(`${ENV.GIT_BINARY} is invalid: must not include surrounding whitespace.`);
  }

  let expanded: string;
  try {
    expanded = expandHomePath(configured);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${ENV.GIT_BINARY} is invalid: ${message}.`, {
      cause: error,
    });
  }
  const validationError = configuredGitBinaryValidationError(expanded);
  if (validationError !== null) {
    throw new Error(`${ENV.GIT_BINARY} is invalid: ${validationError}.`);
  }

  return expanded;
}

export function runGitCommand(
  gitBinary: string,
  args: string[],
  { cwd, timeout = DEFAULT_GIT_COMMAND_TIMEOUT_MS }: GitCommandOptions = {},
): string {
  return execFileSync(gitBinary, args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: DEFAULT_GIT_COMMAND_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  }).replace(/[\r\n]+$/, "");
}

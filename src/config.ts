import fs from "node:fs";
import path from "node:path";

import * as store from "./credential-store.ts";
import { trimEnvValue, validatedHomeDirectory } from "./config-path.ts";
import {
  DEFAULT_SEARCH_ROOTS,
  ENV as MODEL_ENV,
  parseJSONStringArray,
  validateGitSearchRootEntries,
} from "./config-model.ts";

export const DEFAULT_NODE_MAJOR = 26;

export const ENV = MODEL_ENV;

export const DEFAULT_GIT_SEARCH_ROOTS = [...DEFAULT_SEARCH_ROOTS];
const CONFIG_SERVICE = "Triage Companion-Config";
const GIT_SEARCH_ROOTS_ACCOUNT = "git-search-roots";

function isExistingDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function expandHomePath(candidate: string, homeDirectory?: string): string {
  if (candidate === "~") {
    return homeDirectory ?? validatedHomeDirectory();
  }

  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    const resolvedHomeDirectory = homeDirectory ?? validatedHomeDirectory();
    return path.join(resolvedHomeDirectory, candidate.slice(2));
  }

  return candidate;
}

function normalizeStoredSearchRoot(candidate: string, currentDirectory: string = process.cwd()): string {
  if (candidate === "~" || candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    return candidate;
  }

  return path.isAbsolute(candidate) ? candidate : path.resolve(currentDirectory, candidate);
}

function inlineErrorText(text: string): string {
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

function parseStoredSearchRoots(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }

  if (raw.trim() !== raw) {
    throw new Error("Stored Git search roots must not include surrounding whitespace.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = inlineErrorText(error instanceof Error ? error.message : String(error));
    throw new Error(`Stored Git search roots are not valid JSON: ${message}`, {
      cause: error,
    });
  }

  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("Stored Git search roots must be a JSON array of strings.");
  }

  if (parsed.some((value) => value.trim().length === 0)) {
    throw new Error("Stored Git search roots must be a JSON array of non-empty strings.");
  }

  const validation = validateGitSearchRootEntries(parsed);
  if (validation !== null) {
    throw new Error(`Stored Git search roots ${validation}.`);
  }

  return parsed;
}

export function parseSearchRootsInput(raw: string | undefined | null): string[] {
  const roots = parseJSONStringArray(raw, "Git search roots");
  const validation = validateGitSearchRootEntries(roots);
  if (validation !== null) {
    throw new Error(`Git search roots ${validation}.`);
  }
  return roots;
}

export function searchRootsEnvOverrideState(raw: string | undefined | null = process.env[ENV.GIT_SEARCH_ROOTS]): "missing" | "valid" | "invalid" {
  if (trimEnvValue(raw) === null) {
    return "missing";
  }

  try {
    parseSearchRootsInput(raw);
    return "valid";
  } catch {
    return "invalid";
  }
}

export function resolveSearchRoots(raw?: string, baseDirectory?: string): string[] {
  if (raw !== undefined) {
    if (raw.trim().length === 0) {
      throw new Error("Git search roots must be a JSON array of non-empty strings.");
    }

    const configured = parseSearchRootsInput(raw).map((root) =>
      expandHomePath(root, baseDirectory),
    );
    return configured.filter(isExistingDirectory);
  }

  const configuredRaw = process.env[ENV.GIT_SEARCH_ROOTS];
  if (trimEnvValue(configuredRaw) !== null) {
    const configured = parseSearchRootsInput(configuredRaw).map((root) =>
      expandHomePath(root, baseDirectory),
    );
    return configured.filter(isExistingDirectory);
  }

  const stored = parseStoredSearchRoots(store.read(CONFIG_SERVICE, GIT_SEARCH_ROOTS_ACCOUNT)).map((root) =>
    expandHomePath(root, baseDirectory),
  );
  if (stored.length > 0) {
    return stored.filter(isExistingDirectory);
  }

  const resolvedBaseDirectory = baseDirectory ?? validatedHomeDirectory();
  return DEFAULT_GIT_SEARCH_ROOTS.map((root) => path.join(resolvedBaseDirectory, root)).filter(
    isExistingDirectory,
  );
}

export function saveSearchRoots(roots: string[]): string[] {
  if (roots.some((root) => root.trim().length === 0)) {
    throw new Error("Git search roots must not contain blank entries.");
  }

  const validation = validateGitSearchRootEntries(roots);
  if (validation !== null) {
    throw new Error(`Git search roots ${validation}.`);
  }
  const normalizedRoots = roots.map((root) => normalizeStoredSearchRoot(root));
  const normalizedValidation = validateGitSearchRootEntries(normalizedRoots);
  if (normalizedValidation !== null) {
    throw new Error(`Git search roots ${normalizedValidation}.`);
  }
  if (normalizedRoots.length === 0) {
    store.remove(CONFIG_SERVICE, GIT_SEARCH_ROOTS_ACCOUNT);
    return [];
  }

  store.save(
    CONFIG_SERVICE,
    GIT_SEARCH_ROOTS_ACCOUNT,
    JSON.stringify(normalizedRoots),
  );
  return normalizedRoots;
}

export function clearSearchRoots(): void {
  store.remove(CONFIG_SERVICE, GIT_SEARCH_ROOTS_ACCOUNT);
}

export function readSearchRootsConfig(): string[] {
  return parseStoredSearchRoots(store.read(CONFIG_SERVICE, GIT_SEARCH_ROOTS_ACCOUNT));
}

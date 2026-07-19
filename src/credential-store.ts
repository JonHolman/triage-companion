import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveConfigFilePath } from "./config-path.ts";
import { inlineErrorText, isRecord } from "./text.ts";

const SEPARATOR = String.fromCharCode(31);

export interface CredentialUpdate {
  service: string;
  account: string;
  value: string | null;
}

function emptyValues(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

function toStringRecord(data: Record<string, unknown>): Record<string, string> {
  const values = emptyValues();
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") {
      throw new Error("Credential store value must be a string.");
    }

    values[key] = value;
  }

  return values;
}

function filePath(): string {
  return resolveConfigFilePath();
}

// The store file is shared with other processes (concurrent CLI invocations and
// the macOS app), so values are always read fresh from disk; a cross-call cache
// would let a long-lived menu process clobber credentials saved elsewhere.
function loadValues(): Record<string, string> {
  const storePath = filePath();
  const safeStorePath = inlineErrorText(storePath);
  let data: string;
  try {
    data = fs.readFileSync(storePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read credential store ${safeStorePath}: ${inlineErrorText(message)}`, {
        cause: error,
      });
    }

    return emptyValues();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new Error(`Credential store ${safeStorePath} is not valid JSON.`, {
      cause: error,
    });
  }

  if (!isRecord(parsed)) {
    throw new Error(`Credential store ${safeStorePath} must contain a JSON object.`);
  }

  return toStringRecord(parsed);
}

function writeValues(values: Record<string, string>): void {
  const targetPath = filePath();
  const dir = path.dirname(targetPath);
  const tempPath = path.join(dir, `.secrets.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | null = null;
  let createdTemp = false;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    createdTemp = true;
    fs.writeFileSync(fd, JSON.stringify(values), { encoding: "utf-8" });
    fs.closeSync(fd);
    fd = null;
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      if (fd !== null) {
        fs.closeSync(fd);
      }
    } catch {
      // Preserve the original write failure when cleanup also fails.
    }

    if (createdTemp) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // Preserve the original write failure when cleanup also fails.
      }
    }

    throw error;
  }
}

function toStoreKey(service: string, account: string): string {
  return `${service}${SEPARATOR}${account}`;
}

export function configFilePath(): string {
  return filePath();
}

function readRawEnvValue(name: string): string | null {
  return Object.hasOwn(process.env, name) ? (process.env[name] ?? "") : null;
}

export function read(service: string, account: string): string | null {
  const values = loadValues();
  const key = toStoreKey(service, account);
  return Object.hasOwn(values, key) ? values[key] : null;
}

export function save(service: string, account: string, value: string): void {
  const values = loadValues();
  values[toStoreKey(service, account)] = value;
  writeValues(values);
}

export function remove(service: string, account: string): void {
  const values = loadValues();
  const key = toStoreKey(service, account);
  if (!Object.hasOwn(values, key)) {
    return;
  }

  delete values[key];
  writeValues(values);
}

export function updateMany(updates: readonly CredentialUpdate[]): void {
  const values = loadValues();
  let changed = false;
  for (const update of updates) {
    const key = toStoreKey(update.service, update.account);
    if (update.value === null) {
      if (Object.hasOwn(values, key)) {
        delete values[key];
        changed = true;
      }
    } else {
      if (values[key] !== update.value) {
        values[key] = update.value;
        changed = true;
      }
    }
  }

  if (!changed) {
    return;
  }

  writeValues(values);
}

export function readCredential(
  service: string,
  account: string,
  envVar?: string,
): string | null {
  const value = read(service, account);
  if (value !== null) {
    return value;
  }

  if (!envVar) {
    return null;
  }

  return readRawEnvValue(envVar);
}

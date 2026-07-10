import path from "node:path";

import { ENV } from "./config-model.ts";
import { expandHomePath, validatedHomeDirectory } from "./home-path.ts";

export { expandHomePath, validatedHomeDirectory };

export function trimEnvValue(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function textEnvOverrideState(
  value: string | undefined | null,
): "missing" | "valid" | "invalid" {
  if (value === undefined || value === null) {
    return "missing";
  }

  if (value.trim().length === 0) {
    return "invalid";
  }
  if (value.trim() !== value) {
    return "invalid";
  }

  return /[\u0000-\u001F\u007F-\u009F]/.test(value) ? "invalid" : "valid";
}

function validatedEnvPathOverride(
  value: string | undefined,
  envName: string,
): string | null {
  const trimmed = trimEnvValue(value);
  if (trimmed === null) {
    return null;
  }

  if (trimmed !== value) {
    throw new Error(`${envName} is invalid: must not include surrounding whitespace.`);
  }

  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error(`${envName} is invalid: must not include control characters.`);
  }

  return expandHomePath(value);
}

export function resolveConfigDirectory(): string {
  const configured = validatedEnvPathOverride(process.env[ENV.CONFIG_DIR], ENV.CONFIG_DIR);
  if (configured !== null) {
    return configured;
  }

  if (process.platform === "darwin") {
    const homeDirectory = validatedHomeDirectory();
    return path.join(
      homeDirectory,
      "Library",
      "Application Support",
      "Triage Companion",
    );
  }

  if (process.platform === "win32") {
    const configuredAppData = validatedEnvPathOverride(process.env.APPDATA, "APPDATA");
    const base = configuredAppData ?? path.join(validatedHomeDirectory(), "AppData", "Roaming");
    return path.join(base, "Triage Companion");
  }

  const configuredXDG = validatedEnvPathOverride(process.env.XDG_CONFIG_HOME, "XDG_CONFIG_HOME");
  const xdg = configuredXDG ?? path.join(validatedHomeDirectory(), ".config");
  return path.join(xdg, "triage-companion");
}

export function resolveConfigFilePath(fileName: string = "secrets.json"): string {
  return path.join(resolveConfigDirectory(), fileName);
}

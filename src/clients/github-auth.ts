import * as creds from "../credential-store.ts";
import { ENV } from "../config.ts";
import { getServiceDefinition, getServiceSetting } from "../config-model.ts";

const tokenField = getServiceSetting("github", "token");
const SERVICE = tokenField.storage?.service ?? "Triage Companion-GitHub";
const ACCOUNT = tokenField.storage?.account ?? "notifications-token";

export const githubPermissionText = getServiceDefinition("github").status.permissionRequirements
  .map((requirement) => `${requirement.feature}: ${requirement.permissions.join(", ")}`)
  .join("; ");

export function validateConfiguredText(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  if (value.trim() !== value) {
    throw new Error(`${label} must not include surrounding whitespace.`);
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error(`${label} must not include control characters.`);
  }

  return value;
}

export function resolveToken(): string | null {
  const token = creds.readCredential(SERVICE, ACCOUNT, tokenField.envVar ?? ENV.GITHUB_TOKEN);
  return token !== null ? validateConfiguredText(token, "GitHub token") : null;
}

export function hasToken(): boolean {
  try {
    return resolveToken() !== null;
  } catch {
    return false;
  }
}

export function saveToken(token: string): void {
  const validated = validateConfiguredText(token, "GitHub token");
  creds.save(SERVICE, ACCOUNT, validated);
}

export function removeToken(): void {
  creds.remove(SERVICE, ACCOUNT);
}

import * as creds from "../credential-store.ts";
import { validateConfiguredText } from "../text.ts";

export { validateConfiguredText };
import {
  getServiceDefinition,
  getServiceSetting,
  requiredSettingEnvVar,
  requiredSettingStorage,
} from "../config-model.ts";

const tokenField = getServiceSetting("github", "token");
const tokenStorage = requiredSettingStorage(tokenField);
const SERVICE = tokenStorage.service;
const ACCOUNT = tokenStorage.account;

export const githubPermissionText = getServiceDefinition("github").status.permissionRequirements
  .map((requirement) => `${requirement.feature}: ${requirement.permissions.join(", ")}`)
  .join("; ");

export function resolveToken(): string | null {
  const token = creds.readCredential(SERVICE, ACCOUNT, requiredSettingEnvVar(tokenField));
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

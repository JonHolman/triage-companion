export { textEnvOverrideState } from "../config-path.ts";
export { inlineErrorText } from "../text.ts";
import { inlineErrorText } from "../text.ts";
import { parseSearchRootsInput } from "../config.ts";
import type { ServiceModel } from "../config-model.ts";
import { dim } from "../format.ts";

export async function runCommand(
  commandLabel: string,
  action: () => Promise<void> | void,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`triage-companion error in ${commandLabel}: ${inlineErrorText(message)}\n`);
    process.exitCode = 1;
  }
}

export function parseLimit(value: string, label: string): number {
  if (value.trim() !== value) {
    throw new Error(`${label} must not include surrounding whitespace.`);
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label} must be a positive integer.`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

export function parseSearchRootsJSON(value: string, label: string): string[] {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be a JSON array of non-empty strings.`);
  }
  if (value.trim() !== value) {
    throw new Error(`${label} must not include surrounding whitespace.`);
  }

  return parseSearchRootsInput(value);
}

export function printEnvOverrideMessage(
  envVar: string,
  state: "missing" | "valid" | "invalid",
  invalidSubject: string,
  validMessage: string,
): void {
  if (state === "missing") {
    return;
  }

  if (state === "invalid") {
    console.log(
      dim(`${envVar} is still set but invalid, so ${invalidSubject} will fail until it is fixed or unset.`),
    );
    return;
  }

  console.log(dim(validMessage));
}

export function printTokenPermissions(service: ServiceModel): void {
  console.log(dim("Required token permissions:"));
  for (const requirement of service.status.permissionRequirements) {
    console.log(dim(`  ${requirement.feature}: ${requirement.permissions.join(", ")}`));
  }
}

export function printSetupGuidance(service: ServiceModel): void {
  console.log(dim("Setup guidance:"));
  for (const note of service.status.setupGuidance) {
    console.log(dim(`  ${note}`));
  }
}

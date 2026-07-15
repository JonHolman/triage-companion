export { textEnvOverrideState } from "../config-path.ts";
export { inlineErrorText } from "../text.ts";
import { inlineErrorText } from "../text.ts";
import { parseSearchRootsInput } from "../config.ts";
import type { ServiceModel } from "../config-model.ts";
import { dim } from "../format.ts";

const ACTIVITY_NOTICE_DELAY_MS = 750;
const ACTIVITY_DOT_INTERVAL_MS = 1000;
export const SUPPRESS_ACTIVITY_ENV = "TRIAGE_COMPANION_SUPPRESS_ACTIVITY";

interface ActivityNotice {
  stop: () => void;
}

interface ActivityNoticeOptions {
  immediate?: boolean;
}

export function startActivityNotice(
  commandLabel: string,
  { immediate = false }: ActivityNoticeOptions = {},
): ActivityNotice | null {
  if (!process.stderr.isTTY || process.env[SUPPRESS_ACTIVITY_ENV] === "1") {
    return null;
  }

  let started = false;
  let stopped = false;
  let dotTimer: NodeJS.Timeout | null = null;

  const start = (): void => {
    started = true;
    process.stderr.write(dim(`Still running: ${commandLabel}`));
    dotTimer = setInterval(() => {
      process.stderr.write(dim("."));
    }, ACTIVITY_DOT_INTERVAL_MS);
    dotTimer.unref();
  };
  const noticeTimer = immediate
    ? null
    : setTimeout(start, ACTIVITY_NOTICE_DELAY_MS);
  if (noticeTimer === null) {
    start();
  }
  noticeTimer?.unref();

  return {
    stop: () => {
      if (stopped) {
        return;
      }

      stopped = true;
      if (noticeTimer !== null) {
        clearTimeout(noticeTimer);
      }
      if (dotTimer !== null) {
        clearInterval(dotTimer);
      }
      if (started) {
        process.stderr.write("\n");
      }
    },
  };
}

export async function runCommand(
  commandLabel: string,
  action: () => Promise<void> | void,
  options: ActivityNoticeOptions = {},
): Promise<void> {
  const activityNotice = startActivityNotice(commandLabel, options);
  try {
    await action();
  } catch (err) {
    activityNotice?.stop();
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`triage-companion error in ${commandLabel}: ${inlineErrorText(message)}\n`);
    process.exitCode = 1;
  } finally {
    activityNotice?.stop();
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

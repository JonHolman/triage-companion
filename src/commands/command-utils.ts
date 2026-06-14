export { textEnvOverrideState } from "../config-path.ts";

export function inlineErrorText(text: string): string {
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

export function parseLimit(value: string | undefined, label: string, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }

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

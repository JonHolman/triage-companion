import { ESCAPE, parseMenuInput } from "./menu-keys.ts";
import type { MenuKey } from "./menu-types.ts";

export function isMenuInterruptKey(key: MenuKey): boolean {
  return key.ctrl === true && key.name === "c";
}

export const ESCAPE_KEY_TIMEOUT_MS = 500;

export function readMenuKey(): Promise<MenuKey> {
  return new Promise<MenuKey>((resolve) => {
    let pendingInput = "";
    let escapeTimer: NodeJS.Timeout | undefined;

    const armEscapeTimer = (): void => {
      if (!pendingInput) {
        return;
      }

      escapeTimer = setTimeout(() => {
        escapeTimer = undefined;
        const wasBareEscape = pendingInput === ESCAPE;
        pendingInput = "";
        if (wasBareEscape) {
          process.stdin.removeListener("data", onData);
          resolve({ name: "escape", sequence: ESCAPE });
        }
      }, ESCAPE_KEY_TIMEOUT_MS);
    };

    const onData = (chunk: Buffer | string): void => {
      if (escapeTimer) {
        clearTimeout(escapeTimer);
        escapeTimer = undefined;
      }

      const { keys, remainder } = parseMenuInput(pendingInput + String(chunk), 1);
      const key = keys[0];
      if (!key) {
        pendingInput = remainder;
        armEscapeTimer();
        process.stdin.once("data", onData);
        return;
      }

      pendingInput = "";
      if (remainder) {
        process.stdin.pause();
        process.stdin.unshift(Buffer.from(remainder));
      }
      resolve(key);
    };

    process.stdin.once("data", onData);
    process.stdin.resume();
  });
}

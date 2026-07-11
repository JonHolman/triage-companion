import { inlineErrorText } from "./commands/command-utils.ts";
import { ESCAPE, parseMenuInput } from "./menu-keys.ts";
import { pause } from "./menu-prompts.ts";
import { buildMenuTree } from "./menu-tree.ts";
import {
  MenuActionReportedError,
  MenuInterruptedError,
  type MenuItem,
  type MenuKey,
  type MenuNode,
} from "./menu-types.ts";

export { buildMenuTree } from "./menu-tree.ts";
export { MenuActionReportedError, MenuInterruptedError } from "./menu-types.ts";

function renderMenu(node: MenuNode, selected: number): void {
  process.stdout.write("\x1b[2J\x1b[H");
  console.log(node.title);
  console.log("");
  for (const [index, item] of node.items.entries()) {
    const prefix = index === selected ? ">" : " ";
    const line = `${prefix} ${item.label}`;
    console.log(index === selected ? `\x1b[7m${line}\x1b[0m` : line);
  }
  console.log("");
  console.log("Use arrow keys and Enter. Esc or q goes back.");
}

export function isMenuInterruptKey(key: MenuKey): boolean {
  return key.ctrl === true && key.name === "c";
}

// A bare ESC is ambiguous: it is either the Escape key or the first byte of
// an arrow-key sequence split across stdin chunks. Only after this quiet
// period is it treated as the Escape key.
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
        // Input typed ahead of the resolved key is parked on the paused
        // stream so the next reader — another menu key read or a prompt —
        // receives it instead of it being emitted to nobody and lost.
        process.stdin.pause();
        process.stdin.unshift(Buffer.from(remainder));
      }
      resolve(key);
    };

    process.stdin.once("data", onData);
    // Prompts and parked type-ahead leave stdin explicitly paused, and a
    // paused stream never delivers the next key.
    process.stdin.resume();
  });
}

async function activateItem(item: MenuItem): Promise<void> {
  if (item.submenu) {
    await openMenu(item.submenu);
    return;
  }

  if (item.action) {
    await runMenuAction(item);
    await pause();
  }
}

export async function runMenuAction(item: MenuItem): Promise<void> {
  if (!item.action) {
    return;
  }

  try {
    await item.action();
  } catch (error) {
    if (error instanceof MenuActionReportedError) {
      return;
    }
    if (error instanceof MenuInterruptedError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`triage-companion menu error: ${inlineErrorText(message)}\n`);
  }
}

async function openMenu(node: MenuNode): Promise<void> {
  process.stdin.setRawMode(true);

  let selected = 0;
  let done = false;

  try {
    while (!done) {
      renderMenu(node, selected);

      const key = await readMenuKey();

      if (key.name === "up") {
        selected = (selected - 1 + node.items.length) % node.items.length;
        continue;
      }

      if (isMenuInterruptKey(key)) {
        throw new MenuInterruptedError();
      }

      if (key.name === "down") {
        selected = (selected + 1) % node.items.length;
        continue;
      }

      if (key.name === "return") {
        const item = node.items[selected];
        if (!item) {
          continue;
        }

        if (item.label === "Back" || item.label === "Exit") {
          done = true;
          continue;
        }

        process.stdin.setRawMode(false);
        try {
          await activateItem(item);
        } finally {
          process.stdin.setRawMode(true);
        }

        continue;
      }

      if (key.name === "escape" || key.name === "q") {
        done = true;
      }
    }
  } finally {
    process.stdin.setRawMode(false);
  }
}

export async function runInteractiveMenu(): Promise<void> {
  await openMenu(buildMenuTree());
}

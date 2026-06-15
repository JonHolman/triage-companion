import { inlineErrorText } from "./commands/command-utils.ts";
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

function keyFromRawInput(input: string): MenuKey | null {
  if (input.includes("\u0003")) {
    return { ctrl: true, name: "c", sequence: "\u0003" };
  }

  if (input.includes("\u001b[A")) {
    return { name: "up", sequence: input };
  }
  if (input.includes("\u001b[B")) {
    return { name: "down", sequence: input };
  }
  if (input.includes("\u001b")) {
    return { name: "escape", sequence: input };
  }
  if (input.includes("q")) {
    return { name: "q", sequence: input };
  }
  if (input.includes("\r") || input.includes("\n")) {
    return { name: "return", sequence: input };
  }

  return null;
}

function readMenuKey(): Promise<MenuKey> {
  return new Promise<MenuKey>((resolve) => {
    const onData = (chunk: Buffer | string): void => {
      const key = keyFromRawInput(String(chunk));
      if (key) {
        resolve(key);
        return;
      }

      process.stdin.once("data", onData);
    };

    process.stdin.once("data", onData);
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

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`triage-companion menu error: ${inlineErrorText(message)}\n`);
  }
}

async function openMenu(node: MenuNode): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive menu requires a TTY.");
  }

  const wasRaw = Boolean(process.stdin.isRaw);
  const wasPaused = process.stdin.isPaused();
  process.stdin.setRawMode(true);
  process.stdin.resume();

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

      if (key.name === "escape" || key.name === "q" || key.sequence === "q") {
        done = true;
      }
    }
  } finally {
    process.stdin.setRawMode(wasRaw);
    if (wasPaused) {
      process.stdin.pause();
      process.stdin.unref();
    }
  }
}

export async function runInteractiveMenu(): Promise<void> {
  await openMenu(buildMenuTree());
}

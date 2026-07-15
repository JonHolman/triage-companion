import { inlineErrorText } from "./commands/command-utils.ts";
import { isMenuInterruptKey, readMenuKey } from "./menu-input.ts";
import { pause } from "./menu-prompts.ts";
import { buildMenuTree } from "./menu-tree.ts";
export { ESCAPE_KEY_TIMEOUT_MS, isMenuInterruptKey, readMenuKey } from "./menu-input.ts";
import {
  MenuActionReportedError,
  MenuInterruptedError,
  type MenuItem,
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
        if (node.refresh) {
          const refreshed = node.refresh();
          node.title = refreshed.title;
          node.items = refreshed.items;
          selected = Math.min(selected, node.items.length - 1);
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

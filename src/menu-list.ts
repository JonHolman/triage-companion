import { isMenuInterruptKey, readMenuKey } from "./menu-input.ts";
import { dim } from "./format.ts";
import { MenuInterruptedError } from "./menu-types.ts";

const PAGE_SIZE = 10;

export interface MenuListItem {
  id?: string;
  title: string;
  subtitle?: string;
  fields: ReadonlyArray<readonly [string, string]>;
}

interface MenuListActionResult {
  remove?: boolean;
  message?: string;
}

export interface MenuListAction {
  key: string;
  label: string;
  run: (item: MenuListItem, index: number) => Promise<MenuListActionResult> | MenuListActionResult;
}

interface BrowseMenuListOptions {
  emptyMessage?: string;
  actions?: readonly MenuListAction[];
}

function clipped(value: string, width: number): string {
  if (width <= 1 || value.length <= width) {
    return value;
  }

  return `${value.slice(0, Math.max(width - 3, 0))}...`;
}

function renderList(
  title: string,
  items: readonly MenuListItem[],
  selected: number,
  status: string | null,
  { emptyMessage = "No items.", actions = [] }: BrowseMenuListOptions,
): void {
  const width = Math.max(process.stdout.columns || 80, 40);
  const page = items.length === 0 ? 0 : Math.floor(selected / PAGE_SIZE);
  const pageStart = page * PAGE_SIZE;
  const pageItems = items.slice(pageStart, pageStart + PAGE_SIZE);
  const pageEnd = pageStart + pageItems.length;
  const actionHelp = actions.map((action) => `${action.key} ${action.label}`).join(", ");

  process.stdout.write("\x1b[2J\x1b[H");
  console.log(title);
  console.log(dim(items.length === 0 ? "(0 items)" : `(${pageStart + 1}-${pageEnd} of ${items.length})`));
  console.log("");

  if (items.length === 0) {
    console.log(emptyMessage);
  } else {
    for (const [offset, item] of pageItems.entries()) {
      const index = pageStart + offset;
      const prefix = index === selected ? ">" : " ";
      const subtitle = item.subtitle ? ` ${item.subtitle}` : "";
      const line = clipped(`${prefix} ${index + 1}. ${item.title}${subtitle}`, width);
      console.log(index === selected ? `\x1b[7m${line}\x1b[0m` : line);
    }

    const item = items[selected];
    if (item) {
      console.log("");
      for (const [label, value] of item.fields) {
        console.log(clipped(`${label}: ${value}`, width));
      }
    }
  }

  if (status) {
    console.log("");
    console.log(dim(status));
  }

  console.log("");
  console.log(dim(`Up/Down select. n next page. p previous page. Esc/q back.${actionHelp ? ` ${actionHelp}.` : ""}`));
}

export async function browseMenuList(
  title: string,
  initialItems: readonly MenuListItem[],
  options: BrowseMenuListOptions = {},
): Promise<void> {
  const items = [...initialItems];
  const actions = options.actions ?? [];
  const rawModeInput = process.stdin.isTTY && typeof process.stdin.setRawMode === "function";
  const previousRawMode = rawModeInput ? process.stdin.isRaw : false;
  let selected = 0;
  let status: string | null = null;

  if (rawModeInput) {
    process.stdin.setRawMode(true);
  }

  try {
    while (true) {
      if (selected >= items.length) {
        selected = Math.max(items.length - 1, 0);
      }
      renderList(title, items, selected, status, options);
      status = null;

      const key = await readMenuKey();
      if (isMenuInterruptKey(key)) {
        throw new MenuInterruptedError();
      }
      if (key.name === "escape" || key.name === "q") {
        return;
      }
      if (items.length === 0) {
        continue;
      }
      if (key.name === "up") {
        selected = (selected - 1 + items.length) % items.length;
        continue;
      }
      if (key.name === "down") {
        selected = (selected + 1) % items.length;
        continue;
      }
      if (key.name === "n") {
        selected = Math.min(items.length - 1, Math.floor(selected / PAGE_SIZE) * PAGE_SIZE + PAGE_SIZE);
        continue;
      }
      if (key.name === "p") {
        selected = Math.max(0, Math.floor(selected / PAGE_SIZE) * PAGE_SIZE - PAGE_SIZE);
        continue;
      }

      const action = actions.find((candidate) => candidate.key === key.name);
      if (action) {
        const item = items[selected];
        if (!item) {
          continue;
        }
        const result = await action.run(item, selected);
        if (result.remove) {
          items.splice(selected, 1);
        }
        status = result.message ?? null;
      }
    }
  } finally {
    if (rawModeInput) {
      process.stdin.setRawMode(Boolean(previousRawMode));
    }
    process.stdin.pause();
  }
}

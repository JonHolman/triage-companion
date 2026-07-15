import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { browseMenuList } from "./menu-list.ts";

function emitStdin(data: string): void {
  process.stdin.emit("data", Buffer.from(data));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("menu list browser", () => {
  afterEach(() => {
    process.stdin.removeAllListeners("data");
    process.stdin.pause();
  });

  test("pages through list items without rendering every item at once", async () => {
    const originalStdoutWrite = process.stdout.write;
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const items = Array.from({ length: 12 }, (_, index) => ({
        title: `Item ${index + 1}`,
        fields: [["ID", String(index + 1)] as const],
      }));
      const pending = browseMenuList("Items", items);

      await flush();
      emitStdin("n");
      await flush();
      emitStdin("q");
      await pending;
    } finally {
      process.stdout.write = originalStdoutWrite;
    }

    const rendered = stripAnsi(output);
    assert.match(rendered, /\(1-10 of 12\)/);
    assert.match(rendered, /\(11-12 of 12\)/);
  });

  test("item actions can remove the selected item", async () => {
    const originalStdoutWrite = process.stdout.write;
    const marked: string[] = [];
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const pending = browseMenuList(
        "Notifications",
        [
          { id: "1", title: "First", fields: [["ID", "1"]] },
          { id: "2", title: "Second", fields: [["ID", "2"]] },
        ],
        {
          actions: [
            {
              key: "m",
              label: "mark read",
              run: (item) => {
                marked.push(item.id ?? "");
                return { remove: true, message: `Notification ${item.id} marked read.` };
              },
            },
          ],
        },
      );

      await flush();
      emitStdin("m");
      await flush();
      emitStdin("q");
      await pending;
    } finally {
      process.stdout.write = originalStdoutWrite;
    }

    assert.deepEqual(marked, ["1"]);
    assert.match(stripAnsi(output), /Notification 1 marked read/);
  });
});

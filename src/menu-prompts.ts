import { Writable } from "node:stream";
import readline from "node:readline";

import { dim } from "./format.ts";
import { MenuInterruptedError } from "./menu-types.ts";

// Ctrl+C emits SIGINT on the interface and Ctrl+D closes it, neither of which
// invokes the question callback, so both must settle the promise themselves.
function askQuestion(rl: readline.Interface, text: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    rl.once("SIGINT", () => reject(new MenuInterruptedError()));
    rl.once("close", () => resolve(""));
    rl.question(text, resolve);
  });
}

export async function prompt(text: string): Promise<string> {
  const wasRaw = Boolean(process.stdin.isTTY && process.stdin.isRaw);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await askQuestion(rl, text);
  } finally {
    rl.close();
    if (process.stdin.isTTY && wasRaw) {
      process.stdin.setRawMode(true);
    }
  }
}

export async function promptSecret(text: string): Promise<string> {
  const wasRaw = Boolean(process.stdin.isTTY && process.stdin.isRaw);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  process.stdout.write(text);
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: sink,
    terminal: true,
  });

  try {
    return await askQuestion(rl, "");
  } finally {
    rl.close();
    process.stdout.write("\n");
    if (process.stdin.isTTY && wasRaw) {
      process.stdin.setRawMode(true);
    }
  }
}

export function pause(): Promise<void> {
  return prompt(dim("Press Enter to continue... ")).then(() => undefined);
}

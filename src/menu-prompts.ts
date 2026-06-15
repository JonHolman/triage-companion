import { Writable } from "node:stream";
import readline from "node:readline";

import { dim } from "./format.ts";

export async function prompt(text: string): Promise<string> {
  const wasRaw = Boolean(process.stdin.isTTY && process.stdin.isRaw);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(text, (value) => resolve(value));
  });

  rl.close();
  if (process.stdin.isTTY && wasRaw) {
    process.stdin.setRawMode(true);
  }

  return answer;
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

  const answer = await new Promise<string>((resolve) => {
    rl.question("", (value) => resolve(value));
  });

  rl.close();
  process.stdout.write("\n");
  if (process.stdin.isTTY && wasRaw) {
    process.stdin.setRawMode(true);
  }

  return answer;
}

export function pause(): Promise<void> {
  return prompt(dim("Press Enter to continue... ")).then(() => undefined);
}

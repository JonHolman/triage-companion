import assert from "node:assert/strict";
import { Command } from "commander";

export function findCommand(command: Command, name: string): Command {
  const found = command.commands.find((item) => item.name() === name);
  assert.ok(found, `missing command ${name}`);
  return found;
}

export function optionLongNames(command: Command): string[] {
  return command.options.map((option) => option.long).filter((value): value is string => Boolean(value));
}

export async function runRegisteredCommand(
  register: (program: Command) => void,
  args: string[],
): Promise<string> {
  const program = new Command();
  program.exitOverride();
  register(program);

  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await program.parseAsync(["node", "test", ...args]);
    return chunks.join("");
  } finally {
    process.stdout.write = originalWrite;
  }
}

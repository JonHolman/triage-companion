import type { MenuKey } from "./menu-types.ts";

const CTRL_C = "\u0003";
export const ESCAPE = "\u001b";
const CSI_PARAMETER_BYTES = /[0-?]/;
const CSI_INTERMEDIATE_BYTES = /[ -/]/;
const CSI_FINAL_BYTES = /[@-~]/;

export interface ParsedMenuInput {
  readonly keys: MenuKey[];
  readonly remainder: string;
}

// A trailing escape sequence can be split across stdin chunks, so an
// incomplete one (including a bare trailing ESC, which may be the first byte
// of an arrow key) is returned as the remainder for the caller to carry over.
// With a key limit, parsing stops once that many keys are found and the
// unconsumed raw input is returned as the remainder, so type-ahead meant for
// a later reader (such as a prompt) survives verbatim.
export function parseMenuInput(input: string, limit = Number.POSITIVE_INFINITY): ParsedMenuInput {
  const keys: MenuKey[] = [];
  let index = 0;

  while (index < input.length && keys.length < limit) {
    const character = input[index] ?? "";

    if (character === CTRL_C) {
      keys.push({ ctrl: true, name: "c", sequence: CTRL_C });
      index += 1;
      continue;
    }

    if (character === ESCAPE) {
      const next = input[index + 1];

      if (next === undefined) {
        return { keys, remainder: ESCAPE };
      }

      if (next === "[") {
        let end = index + 2;
        while (end < input.length && CSI_PARAMETER_BYTES.test(input[end] ?? "")) {
          end += 1;
        }
        while (end < input.length && CSI_INTERMEDIATE_BYTES.test(input[end] ?? "")) {
          end += 1;
        }
        if (end >= input.length) {
          return { keys, remainder: input.slice(index) };
        }

        // A byte outside the CSI final range means the sequence is malformed
        // (for example a dangling "ESC [" followed by Ctrl+C). The malformed
        // prefix is dropped and the byte is left for the next iteration so a
        // control key is never swallowed as a bogus terminator.
        if (!CSI_FINAL_BYTES.test(input[end] ?? "")) {
          index = end;
          continue;
        }

        const sequence = input.slice(index, end + 1);
        if (sequence === `${ESCAPE}[A`) {
          keys.push({ name: "up", sequence });
        } else if (sequence === `${ESCAPE}[B`) {
          keys.push({ name: "down", sequence });
        }

        index = end + 1;
        continue;
      }

      if (next === "O") {
        if (index + 2 >= input.length) {
          return { keys, remainder: input.slice(index) };
        }

        const sequence = input.slice(index, index + 3);
        if (sequence === `${ESCAPE}OA`) {
          keys.push({ name: "up", sequence });
        } else if (sequence === `${ESCAPE}OB`) {
          keys.push({ name: "down", sequence });
        }

        index += 3;
        continue;
      }

      keys.push({ name: "escape", sequence: ESCAPE });
      index += 1;
      continue;
    }

    if (character === "\r" || character === "\n") {
      keys.push({ name: "return", sequence: character });
      index += 1;
      continue;
    }

    if (["d", "m", "n", "p", "q"].includes(character)) {
      keys.push({ name: character, sequence: character });
      index += 1;
      continue;
    }

    index += 1;
  }

  return { keys, remainder: input.slice(index) };
}

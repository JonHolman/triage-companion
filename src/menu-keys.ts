import type { MenuKey } from "./menu-types.ts";

const CTRL_C = "\u0003";
const ESCAPE = "\u001b";
const CSI_PARAMETER_BYTES = /[0-?]/;
const CSI_INTERMEDIATE_BYTES = /[ -/]/;

export function parseMenuKeys(input: string): MenuKey[] {
  const keys: MenuKey[] = [];
  let index = 0;

  while (index < input.length) {
    const character = input[index] ?? "";

    if (character === CTRL_C) {
      keys.push({ ctrl: true, name: "c", sequence: CTRL_C });
      index += 1;
      continue;
    }

    if (character === ESCAPE) {
      const next = input[index + 1];

      if (next === "[") {
        let end = index + 2;
        while (end < input.length && CSI_PARAMETER_BYTES.test(input[end] ?? "")) {
          end += 1;
        }
        while (end < input.length && CSI_INTERMEDIATE_BYTES.test(input[end] ?? "")) {
          end += 1;
        }
        if (end >= input.length) {
          break;
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
          break;
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

    if (character === "q") {
      keys.push({ name: "q", sequence: "q" });
      index += 1;
      continue;
    }

    index += 1;
  }

  return keys;
}

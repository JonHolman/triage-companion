import { Writable } from "node:stream";
import readline from "node:readline";

import { dim } from "./format.ts";
import { ESCAPE } from "./menu-keys.ts";
import { MenuInterruptedError } from "./menu-types.ts";

const PROMPT_CANCELED = Symbol("prompt-canceled");
type PromptAnswer = string | typeof PROMPT_CANCELED;

function isCancelInput(value: string): boolean {
  return value === "q" || value === ESCAPE;
}

// Ctrl+C emits SIGINT on the interface and Ctrl+D closes it, neither of which
// invokes the question callback, so both must settle the promise themselves.
function askQuestion(
  rl: readline.Interface,
  text: string,
  { cancelNewline = true }: { cancelNewline?: boolean } = {},
): Promise<PromptAnswer> {
  return new Promise<PromptAnswer>((resolve, reject) => {
    let settled = false;
    const input = process.stdin;
    const rawModeInput = input.isTTY && typeof input.setRawMode === "function";
    const previousRawMode = rawModeInput ? input.isRaw : false;
    const wasPaused = input.isPaused();

    const restoreInput = (): void => {
      input.off("data", handleData);
      if (rawModeInput) {
        input.setRawMode(Boolean(previousRawMode));
      }
      if (rawModeInput || wasPaused) {
        input.pause();
      }
    };
    const settle = (value: PromptAnswer): void => {
      if (settled) {
        return;
      }

      settled = true;
      restoreInput();
      resolve(value);
    };
    const cancel = (): void => {
      if (cancelNewline) {
        process.stdout.write("\n");
      }
      settle(PROMPT_CANCELED);
      rl.close();
    };
    function handleData(chunk: Buffer | string): void {
      if (String(chunk) === ESCAPE) {
        cancel();
      }
    }

    if (rawModeInput) {
      input.on("data", handleData);
      input.setRawMode(true);
    }

    rl.once("SIGINT", () => {
      restoreInput();
      reject(new MenuInterruptedError());
    });
    rl.once("close", () => settle(PROMPT_CANCELED));
    rl.question(text, (value) => settle(isCancelInput(value) ? PROMPT_CANCELED : value));
  });
}

async function readPrompt(text: string): Promise<PromptAnswer> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await askQuestion(rl, text);
  } finally {
    rl.close();
  }
}

export async function prompt(text: string): Promise<string> {
  const answer = await readPrompt(text);
  return answer === PROMPT_CANCELED ? "" : answer;
}

export async function promptWithCancel(text: string): Promise<string | null> {
  const answer = await readPrompt(text);
  return answer === PROMPT_CANCELED ? null : answer;
}

export async function promptSecret(text: string): Promise<string> {
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
    const answer = await askQuestion(rl, "", { cancelNewline: false });
    return answer === PROMPT_CANCELED ? "" : answer;
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
}

export function pause(): Promise<void> {
  return prompt(dim("Press Enter to continue... ")).then(() => undefined);
}

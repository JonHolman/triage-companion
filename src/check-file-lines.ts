import { execFileSync } from "node:child_process";
import fs from "node:fs";

const MAX_CODE_LINES = 500;
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".cts", ".mts"]);
const TYPESCRIPT_EXTENSIONS = new Set([".ts"]);
const IGNORED_PREFIXES = ["node_modules/"];

function sourceControlledFiles(): string[] {
  const output = execFileSync("git", ["ls-files"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return [...output.split("\n"), ...untracked.split("\n")]
    .filter((file) => file && fs.existsSync(file))
    .sort();
}

function isIgnored(file: string): boolean {
  return IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function extensionOf(file: string): string {
  const match = /\.[^.]+$/.exec(file);
  return match?.[0] ?? "";
}

function countLines(file: string): number {
  const text = fs.readFileSync(file, "utf8");
  if (text.length === 0) {
    return 0;
  }

  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

const codeFiles = sourceControlledFiles().filter((file) => {
  return !isIgnored(file) && CODE_EXTENSIONS.has(extensionOf(file));
});

const nonTypeScriptFiles = codeFiles.filter((file) => {
  return !TYPESCRIPT_EXTENSIONS.has(extensionOf(file));
});
const longFiles = codeFiles
  .map((file) => ({ file, lines: countLines(file) }))
  .filter(({ lines }) => lines > MAX_CODE_LINES)
  .sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));

if (nonTypeScriptFiles.length > 0 || longFiles.length > 0) {
  for (const file of nonTypeScriptFiles) {
    console.error(`${file}: code files must be TypeScript`);
  }
  for (const { file, lines } of longFiles) {
    console.error(`${file}: ${lines} lines exceeds ${MAX_CODE_LINES}`);
  }
  process.exit(1);
}

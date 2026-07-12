#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 15);
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(os.homedir(), "data", "triage-companion-demo", "recordings");
fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

const outputPath = path.join(outputDirectory, `triage-companion-demo-${timestamp()}.gif`);
const result = spawnSync("vhs", ["--output", outputPath, "demo/live-demo.tape"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Recorded ${outputPath}`);

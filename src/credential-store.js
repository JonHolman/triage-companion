import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SEPARATOR = String.fromCharCode(31);

let cachedValues = null;

function fileDir() {
  if (process.env.TRIAGE_COMPANION_CONFIG_DIR) {
    return process.env.TRIAGE_COMPANION_CONFIG_DIR;
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Triage Companion"
    );
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, "triage-companion");
}

function filePath() {
  return path.join(fileDir(), "secrets.json");
}

export function configFilePath() {
  return filePath();
}

function compositeKey(service, account) {
  return `${service}${SEPARATOR}${account}`;
}

function loadValues() {
  if (cachedValues !== null) return cachedValues;
  try {
    const data = fs.readFileSync(filePath(), "utf-8");
    cachedValues = JSON.parse(data);
  } catch {
    cachedValues = {};
  }
  return cachedValues;
}

function writeValues(values) {
  const dir = fileDir();
  fs.mkdirSync(dir, { recursive: true });
  const fp = filePath();
  fs.writeFileSync(fp, JSON.stringify(values), { mode: 0o600 });
  try {
    fs.chmodSync(fp, 0o600);
  } catch {
    // best effort
  }
}

export function save(service, account, value) {
  const values = loadValues();
  values[compositeKey(service, account)] = value;
  cachedValues = values;
  writeValues(values);
}

export function read(service, account) {
  const values = loadValues();
  const value = values[compositeKey(service, account)];
  return value !== undefined ? value : null;
}

/** Reset cache — useful when tests or re‑reads are needed. */
export function resetCache() {
  cachedValues = null;
}

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { ENV } from "./config-model.ts";
import {
  expandHomePath,
  resolveConfigDirectory,
  resolveConfigFilePath,
  textEnvOverrideState,
  trimEnvValue,
} from "./config-path.ts";

let originalConfigDir: string | undefined;
let originalXDGConfigHome: string | undefined;
let originalAppData: string | undefined;
let originalHome: string | undefined;
let originalPlatform: NodeJS.Platform;

beforeEach(() => {
  originalConfigDir = process.env[ENV.CONFIG_DIR];
  originalXDGConfigHome = process.env.XDG_CONFIG_HOME;
  originalAppData = process.env.APPDATA;
  originalHome = process.env.HOME;
  originalPlatform = process.platform;
});

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env[ENV.CONFIG_DIR];
  } else {
    process.env[ENV.CONFIG_DIR] = originalConfigDir;
  }

  if (originalXDGConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXDGConfigHome;
  }

  if (originalAppData === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  Object.defineProperty(process, "platform", { value: originalPlatform });
});

describe("config path resolution", () => {
  test("trims empty environment values", () => {
    assert.equal(trimEnvValue(undefined), null);
    assert.equal(trimEnvValue("   "), null);
    assert.equal(trimEnvValue(" value "), "value");
  });

  test("classifies text environment overrides by validity", () => {
    assert.equal(textEnvOverrideState(undefined), "missing");
    assert.equal(textEnvOverrideState("   "), "invalid");
    assert.equal(textEnvOverrideState("value"), "valid");
    assert.equal(textEnvOverrideState(" value "), "invalid");
    assert.equal(textEnvOverrideState("bad\nvalue"), "invalid");
  });

  test("expands home-relative config directory overrides", () => {
    process.env[ENV.CONFIG_DIR] = "~/triage-companion-test";

    assert.equal(
      resolveConfigDirectory(),
      path.join(os.homedir(), "triage-companion-test"),
    );
    assert.equal(
      resolveConfigFilePath("settings.json"),
      path.join(os.homedir(), "triage-companion-test", "settings.json"),
    );
  });

  test("rejects config directory overrides with surrounding whitespace", () => {
    process.env[ENV.CONFIG_DIR] = " ~/triage-companion-test ";

    assert.throws(
      () => resolveConfigDirectory(),
      /TRIAGE_COMPANION_CONFIG_DIR is invalid: must not include surrounding whitespace/,
    );
  });

  test("rejects config directory overrides with control characters", () => {
    process.env[ENV.CONFIG_DIR] = "~/triage-companion\tbad";

    assert.throws(
      () => resolveConfigDirectory(),
      /TRIAGE_COMPANION_CONFIG_DIR is invalid: must not include control characters/,
    );
  });

  test("rejects home-relative config directory overrides when HOME has surrounding whitespace", () => {
    process.env.HOME = " /tmp/home-with-space ";
    process.env[ENV.CONFIG_DIR] = "~/triage-companion-test";

    assert.throws(
      () => resolveConfigDirectory(),
      /Home directory is invalid: must not include surrounding whitespace/,
    );
  });

  test("uses absolute config directory overrides without requiring a valid HOME", () => {
    process.env.HOME = "/tmp/home\twith-tab";
    process.env[ENV.CONFIG_DIR] = "/tmp/triage-companion-test";

    assert.equal(resolveConfigDirectory(), "/tmp/triage-companion-test");
  });

  test("expands home-relative local tool paths", () => {
    assert.equal(expandHomePath("~/bin/git"), path.join(os.homedir(), "bin", "git"));
    assert.equal(expandHomePath("~"), os.homedir());
    assert.equal(expandHomePath("/usr/bin/git"), "/usr/bin/git");
  });

  test("leaves absolute local tool paths alone without requiring a valid HOME", () => {
    process.env.HOME = "/tmp/home\twith-tab";

    assert.equal(expandHomePath("/usr/bin/git"), "/usr/bin/git");
  });

  test("rejects default home directory values with surrounding whitespace", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    delete process.env[ENV.CONFIG_DIR];
    process.env.HOME = " /tmp/home-with-space ";

    assert.throws(
      () => resolveConfigDirectory(),
      /Home directory is invalid: must not include surrounding whitespace/,
    );
  });

  test("rejects default home directory values with control characters", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    delete process.env[ENV.CONFIG_DIR];
    process.env.HOME = "/tmp/home\twith-tab";

    assert.throws(
      () => resolveConfigDirectory(),
      /Home directory is invalid: must not include control characters/,
    );
  });

  test("expands home-relative XDG config home on Linux-like platforms", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    delete process.env[ENV.CONFIG_DIR];
    process.env.XDG_CONFIG_HOME = "~/.xdg-config-test";

    assert.equal(
      resolveConfigDirectory(),
      path.join(os.homedir(), ".xdg-config-test", "triage-companion"),
    );
  });

  test("rejects XDG config home with surrounding whitespace", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    delete process.env[ENV.CONFIG_DIR];
    process.env.XDG_CONFIG_HOME = " ~/.xdg-config-test ";

    assert.throws(
      () => resolveConfigDirectory(),
      /XDG_CONFIG_HOME is invalid: must not include surrounding whitespace/,
    );
  });

  test("rejects XDG config home with control characters", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    delete process.env[ENV.CONFIG_DIR];
    process.env.XDG_CONFIG_HOME = "~/.xdg-config\tbad";

    assert.throws(
      () => resolveConfigDirectory(),
      /XDG_CONFIG_HOME is invalid: must not include control characters/,
    );
  });

  test("uses absolute XDG config homes without requiring a valid HOME", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    delete process.env[ENV.CONFIG_DIR];
    process.env.HOME = "/tmp/home\twith-tab";
    process.env.XDG_CONFIG_HOME = "/tmp/.xdg-config-test";

    assert.equal(resolveConfigDirectory(), "/tmp/.xdg-config-test/triage-companion");
  });

  test("rejects APPDATA with surrounding whitespace", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env[ENV.CONFIG_DIR];
    process.env.APPDATA = " ~/AppData/Roaming ";

    assert.throws(
      () => resolveConfigDirectory(),
      /APPDATA is invalid: must not include surrounding whitespace/,
    );
  });

  test("rejects APPDATA with control characters", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env[ENV.CONFIG_DIR];
    process.env.APPDATA = "~/AppData\tRoaming";

    assert.throws(
      () => resolveConfigDirectory(),
      /APPDATA is invalid: must not include control characters/,
    );
  });

  test("uses absolute APPDATA without requiring a valid HOME", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env[ENV.CONFIG_DIR];
    process.env.HOME = "/tmp/home\twith-tab";
    process.env.APPDATA = "/tmp/AppData/Roaming";

    assert.equal(resolveConfigDirectory(), "/tmp/AppData/Roaming/Triage Companion");
  });
});

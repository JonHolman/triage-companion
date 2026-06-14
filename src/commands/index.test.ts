import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Command } from "commander";

import { registerCommands } from "./index.ts";

describe("command registration", () => {
  test("registers every top-level command group", () => {
    const program = new Command();
    registerCommands(program);

    assert.deepEqual(
      program.commands.map((command) => command.name()),
      ["github", "snyk", "jira", "git", "status", "config"],
    );
  });
});

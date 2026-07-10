import { Command } from "commander";

import { buildConfigurationSummary } from "../config-summary.ts";
import {
  clearSearchRoots,
  resolveSearchRoots,
  saveSearchRoots,
  searchRootsEnvOverrideState,
} from "../config.ts";
import { ENV } from "../config-model.ts";
import { parseSearchRootsJSON, runCommand } from "./command-utils.ts";

export function register(program: Command): void {
  const cmd = program.command("config").description("Configuration management");

  const printSearchRootsOverrideMessage = (validMessage: string): void => {
    const state = searchRootsEnvOverrideState();
    if (state === "missing") {
      return;
    }

    if (state === "invalid") {
      console.log(
        `  ${ENV.GIT_SEARCH_ROOTS} is still set but invalid, so Git repository discovery will fail until it is fixed or unset.`,
      );
      return;
    }

    console.log(`  ${validMessage}`);
  };

  const reportSearchRootsCleared = (): void => {
    if (searchRootsEnvOverrideState() !== "missing") {
      console.log("✓ Stored Git search roots cleared.");
      printSearchRootsOverrideMessage(`${ENV.GIT_SEARCH_ROOTS} still overrides the defaults when set.`);
      return;
    }

    console.log("✓ Git search roots reset to defaults.");
  };

  cmd
    .command("show")
    .description("Show configured values without exposing secrets")
    .action(() => {
      return runCommand("config show", () => {
        process.stdout.write(buildConfigurationSummary());
      });
    });

  cmd
    .command("git-search-roots")
    .description("Save Git repository search roots")
    .argument(
      "<paths-json>",
      "Search roots as a JSON array of paths",
    )
    .action((paths: string) => {
      return runCommand("config git-search-roots", () => {
        const roots = parseSearchRootsJSON(paths, "Git search roots");
        const savedRoots = saveSearchRoots(roots);
        if (roots.length === 0) {
          reportSearchRootsCleared();
          return;
        }

        console.log(`✓ Git search roots saved: ${savedRoots.join(", ")}`);
        const effectiveRoots = resolveSearchRoots(JSON.stringify(savedRoots));
        if (effectiveRoots.length !== roots.length) {
          if (effectiveRoots.length === 0) {
            console.log("  None of the saved roots currently exist as directories, so Git repository discovery will return no repositories.");
          } else {
            console.log("  Some saved roots do not currently exist as directories and will be ignored.");
          }
        }
        printSearchRootsOverrideMessage(`${ENV.GIT_SEARCH_ROOTS} still overrides the saved roots when set.`);
      });
    });

  cmd
    .command("reset-git-search-roots")
    .description("Reset Git repository search roots to defaults")
    .action(() => {
      return runCommand("config reset-git-search-roots", () => {
        clearSearchRoots();
        reportSearchRootsCleared();
      });
    });
}

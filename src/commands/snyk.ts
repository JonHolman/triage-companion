import { Command } from "commander";

import * as snyk from "../clients/snyk.ts";
import {
  bold,
  dim,
  relativeTime,
  severityColor,
  responsiveTable,
} from "../format.ts";
import { ENV, getServiceDefinition } from "../config-model.ts";
import {
  KNOWN_SEVERITIES,
  normalizedKnownSeverity,
  summarizeSeverities,
} from "../severity.ts";
import { runCommand, textEnvOverrideState } from "./command-utils.ts";

const snykService = getServiceDefinition("snyk");

function printTokenPermissions(): void {
  console.log(dim("Required token permissions:"));
  for (const requirement of snykService.status.permissionRequirements) {
    console.log(dim(`  ${requirement.feature}: ${requirement.permissions.join(", ")}`));
  }
}

function printSetupGuidance(): void {
  console.log(dim("Setup guidance:"));
  for (const note of snykService.status.setupGuidance) {
    console.log(dim(`  ${note}`));
  }
}

function printAPIBaseURLOverrideMessage(context: "saved" | "default"): void {
  const state = snyk.apiBaseURLEnvOverrideState();
  if (state === "missing") {
    return;
  }

  if (state === "invalid") {
    console.log(dim(`${ENV.SNYK_API_BASE_URL} is still set but invalid, so Snyk commands will fail until it is fixed or unset.`));
    return;
  }

  console.log(
    dim(
      context === "saved"
        ? `${ENV.SNYK_API_BASE_URL} still overrides the saved API base URL when set.`
        : `${ENV.SNYK_API_BASE_URL} still overrides the US-01 default when set.`,
    ),
  );
}

export function parseSeverityFilter(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.length === 0) {
    throw new Error("--severity must not be empty.");
  }
  if (value.trim() !== value) {
    throw new Error("--severity must not include surrounding whitespace.");
  }

  const normalized = value.toLowerCase();
  const severity = normalizedKnownSeverity(normalized);
  if (!severity) {
    throw new Error(`--severity must be one of: ${KNOWN_SEVERITIES.join(", ")}.`);
  }

  return severity;
}

export function register(program: Command): void {
  const cmd = program.command("snyk").description("Snyk security issues");

  cmd
    .command("token")
    .description("Save a Snyk API token")
    .argument("<token>", "Snyk API token")
    .action((token: string) => {
      return runCommand("snyk token", () => {
        snyk.saveToken(token);
        console.log("✓ Snyk token saved.");
        printSetupGuidance();
        printTokenPermissions();
      });
    });

  cmd
    .command("remove-token")
    .description("Remove the saved Snyk API token")
    .action(() => {
      return runCommand("snyk remove-token", () => {
        snyk.removeToken();
        console.log("✓ Snyk token removed.");
        const tokenState = textEnvOverrideState(process.env.SNYK_TOKEN);
        if (tokenState === "invalid") {
          console.log(dim("SNYK_TOKEN is still set but invalid, so Snyk commands will fail until it is fixed or unset."));
        } else if (tokenState === "valid") {
          console.log(dim("SNYK_TOKEN still provides the effective Snyk token when set."));
        }
      });
    });

  cmd
    .command("api-base-url")
    .description("Save the US-hosted Snyk REST API base URL")
    .argument("<url>", "Snyk REST API base URL")
    .action((url: string) => {
      return runCommand("snyk api-base-url", () => {
        const saved = snyk.saveAPIBaseURL(url);
        console.log(`✓ Snyk API base URL saved: ${saved}`);
        printAPIBaseURLOverrideMessage("saved");
      });
    });

  cmd
    .command("reset-api-base-url")
    .description("Remove the stored Snyk REST API base URL")
    .action(() => {
      return runCommand("snyk reset-api-base-url", () => {
        snyk.removeAPIBaseURL();
        console.log("✓ Stored Snyk API base URL reset.");
        printAPIBaseURLOverrideMessage("default");
      });
    });

  cmd
    .command("issues")
    .description("List open Snyk issues across organizations")
    .option(
      "--severity <level>",
      "Filter by severity (critical, high, medium, low)",
    )
    .option("--json", "Output as JSON", false)
    .action((opts: { severity?: string; json: boolean }) => {
      return runCommand("snyk issues", async () => {
        const snapshot = await snyk.listOpenIssues({
          severity: parseSeverityFilter(opts.severity),
        });

        if (opts.json) {
          console.log(JSON.stringify(snapshot, null, 2));
          return;
        }

        const { issues, organizationCount, projectCount } = snapshot;
        if (issues.length === 0) {
          console.log("No open Snyk issues.");
          return;
        }

        const summary = summarizeSeverities(issues.map((issue) => issue.severity));
        const severityText = summary ? `: ${summary}` : "";

        console.log(
          `${bold("Snyk Issues")} ${dim(`(${issues.length} issues in ${projectCount} projects; checked ${organizationCount} orgs${severityText})\n`)}`,
        );

        const rows = issues.map((issue) => [
          issue.url,
          severityColor(issue.severity, issue.severity.toUpperCase()),
          issue.organizationName,
          issue.projectName,
          issue.title,
          issue.packageName ?? "–",
          issue.issueType,
          relativeTime(issue.updatedAt),
        ]);

        console.log(
          responsiveTable(rows, {
            headers: [
              "Link",
              "Severity",
              "Org",
              "Project",
              "Title",
              "Package",
              "Type",
              "Updated",
            ],
          }),
        );
      });
    });
}

import { Command } from "commander";

import * as jira from "../clients/jira.ts";
import { ENV } from "../config-model.ts";
import { bold, dim, responsiveTable } from "../format.ts";
import { getServiceDefinition } from "../config-model.ts";
import {
  printEnvOverrideMessage,
  printSetupGuidance,
  printTokenPermissions,
  runCommand,
  textEnvOverrideState,
} from "./command-utils.ts";

const jiraService = getServiceDefinition("jira");

function printBaseURLOverrideMessage(context: "saved" | "effective"): void {
  printEnvOverrideMessage(
    ENV.JIRA_BASE_URL,
    jira.baseURLEnvOverrideState(),
    "Jira commands",
    context === "saved"
      ? `${ENV.JIRA_BASE_URL} still overrides the saved Jira base URL when set.`
      : `${ENV.JIRA_BASE_URL} still provides the effective Jira base URL when set.`,
  );
}

function printCredentialOverrideMessage(
  envVar: string,
  validMessage: string,
): void {
  printEnvOverrideMessage(
    envVar,
    textEnvOverrideState(process.env[envVar]),
    "Jira commands",
    validMessage,
  );
}

export function register(program: Command): void {
  const cmd = program.command("jira").description("Jira tickets");

  cmd
    .command("credentials")
    .description("Save Jira credentials")
    .argument("<base-url>", "Jira base URL (for example https://your-company.atlassian.net)")
    .argument("<email>", "Jira account email")
    .argument("<token>", "Jira API token")
    .action((baseURL: string, email: string, token: string) => {
      return runCommand("jira credentials", () => {
        jira.saveCredentials(baseURL, email, token);
        console.log("✓ Jira credentials saved.");
        printBaseURLOverrideMessage("saved");
        printCredentialOverrideMessage(
          ENV.JIRA_EMAIL,
          `${ENV.JIRA_EMAIL} still overrides the saved Jira email when set.`,
        );
        printCredentialOverrideMessage(
          ENV.JIRA_API_TOKEN,
          `${ENV.JIRA_API_TOKEN} still overrides the saved Jira API token when set.`,
        );
        printSetupGuidance(jiraService);
        printTokenPermissions(jiraService);
      });
    });

  cmd
    .command("remove-credentials")
    .description("Remove saved Jira credentials")
    .action(() => {
      return runCommand("jira remove-credentials", () => {
        jira.removeCredentials();
        console.log("✓ Jira credentials removed.");
        printBaseURLOverrideMessage("effective");
        printCredentialOverrideMessage(
          ENV.JIRA_EMAIL,
          `${ENV.JIRA_EMAIL} still provides the effective Jira email when set.`,
        );
        printCredentialOverrideMessage(
          ENV.JIRA_API_TOKEN,
          `${ENV.JIRA_API_TOKEN} still provides the effective Jira API token when set.`,
        );
      });
    });

  cmd
    .command("tickets")
    .description("List open Jira tickets assigned to you")
    .option("--json", "Output as JSON", false)
    .action((opts: { json: boolean }) => {
      return runCommand("jira tickets", async () => {
        const tickets = await jira.listOpenTickets();

        if (opts.json) {
          console.log(JSON.stringify(tickets, null, 2));
          return;
        }

        if (tickets.length === 0) {
          console.log("No open Jira tickets.");
          return;
        }

        console.log(`${bold("Jira Tickets")} ${dim(`(${tickets.length} open)\n`)}`);

        const rows = tickets.map((ticket) => [
          ticket.url,
          ticket.key,
          ticket.issueType,
          ticket.status,
          ticket.priority ?? "–",
          ticket.reporter ?? "–",
          ticket.updatedText,
          ticket.summary,
        ]);

        console.log(
          responsiveTable(rows, {
            headers: [
              "Link",
              "Key",
              "Type",
              "Status",
              "Priority",
              "Reporter",
              "Updated",
              "Summary",
            ],
          }),
        );
      });
    });
}

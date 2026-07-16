import { Command } from "commander";

import * as jira from "../clients/jira.ts";
import * as jiraActions from "../clients/jira-actions.ts";
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

function printCloudIDOverrideMessage(context: "saved" | "effective"): void {
  printEnvOverrideMessage(
    ENV.JIRA_CLOUD_ID,
    jira.cloudIDEnvOverrideState(),
    "Jira commands",
    context === "saved"
      ? `${ENV.JIRA_CLOUD_ID} still overrides the saved Jira Cloud ID when set.`
      : `${ENV.JIRA_CLOUD_ID} still provides the effective Jira Cloud ID when set.`,
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
    .argument("[cloud-id]", "Jira Cloud ID for scoped Atlassian API tokens")
    .action((baseURL: string, email: string, token: string, cloudID?: string) => {
      return runCommand("jira credentials", () => {
        jira.saveCredentials(baseURL, email, token, cloudID);
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
        printCloudIDOverrideMessage("saved");
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
        printCloudIDOverrideMessage("effective");
      });
    });

  cmd
    .command("create-ticket")
    .description("Create a Jira ticket")
    .argument("<project-key>", "Jira project key")
    .argument("<summary>", "Jira ticket summary")
    .option("--type <issue-type>", "Jira issue type", "Task")
    .option("--description <text>", "Jira issue description")
    .action((
      projectKey: string,
      summary: string,
      opts: { type: string; description?: string },
    ) => {
      return runCommand("jira create-ticket", async () => {
        const ticket = await jiraActions.createTicket({
          projectKey,
          issueType: opts.type,
          summary,
          description: opts.description,
        });
        console.log(`✓ Jira ticket ${ticket.key} created: ${ticket.url}`);
      });
    });

  cmd
    .command("comment-ticket")
    .description("Add a comment to a Jira ticket")
    .argument("<issue-key>", "Jira issue key")
    .argument("<comment>", "Comment text")
    .action((issueKey: string, comment: string) => {
      return runCommand("jira comment-ticket", async () => {
        const result = await jiraActions.addComment(issueKey, comment);
        console.log(`✓ Jira comment ${result.id} added to ${result.issueKey}.`);
      });
    });

  cmd
    .command("assign-sprint")
    .description("Assign a Jira ticket to a sprint")
    .argument("<issue-key>", "Jira issue key")
    .argument("<sprint-id>", "Jira sprint ID")
    .action((issueKey: string, sprintID: string) => {
      return runCommand("jira assign-sprint", async () => {
        await jiraActions.assignTicketToSprint(issueKey, sprintID);
        console.log(`✓ Jira ticket ${issueKey.toUpperCase()} assigned to sprint ${sprintID}.`);
      });
    });

  cmd
    .command("change-status")
    .description("Change a Jira ticket status")
    .argument("<issue-key>", "Jira issue key")
    .argument("<status>", "Target status")
    .action((issueKey: string, status: string) => {
      return runCommand("jira change-status", async () => {
        const result = await jiraActions.changeTicketStatus(issueKey, status);
        console.log(`✓ Jira ticket ${result.issueKey} changed to ${result.status}.`);
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

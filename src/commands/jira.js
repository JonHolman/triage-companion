import * as jira from "../clients/jira.js";
import { bold, dim, table, truncate } from "../format.js";

export function register(program) {
  const cmd = program.command("jira").description("Jira tickets");

  // ── credentials ──────────────────────────────────────────────────
  cmd
    .command("credentials")
    .description("Save Jira credentials")
    .argument("<base-url>", "Jira base URL (e.g. https://myorg.atlassian.net)")
    .argument("<email>", "Jira account email")
    .argument("<token>", "Jira API token")
    .action((baseURL, email, token) => {
      jira.saveCredentials(baseURL, email, token);
      console.log("✓ Jira credentials saved.");
    });

  // ── tickets ──────────────────────────────────────────────────────
  cmd
    .command("tickets")
    .description("List open Jira tickets assigned to you")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const tickets = await jira.listOpenTickets();

        if (opts.json) {
          console.log(JSON.stringify(tickets, null, 2));
          return;
        }

        if (tickets.length === 0) {
          console.log("No open Jira tickets.");
          return;
        }

        console.log(bold(`Jira Tickets`) + dim(` (${tickets.length} open)\n`));

        const rows = tickets.map((t) => [
          t.key,
          t.issueType,
          t.status,
          t.priority,
          truncate(t.reporter ?? "", 18),
          t.updatedText,
          truncate(t.summary, 45),
        ]);

        console.log(
          table(rows, {
            headers: ["Key", "Type", "Status", "Priority", "Reporter", "Updated", "Summary"],
          })
        );

        console.log(dim(`\nOpen in browser: ${tickets[0]?.url?.replace(/\/browse\/.*/, "/browse/<KEY>")}`));
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });
}

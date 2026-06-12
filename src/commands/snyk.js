import * as snyk from "../clients/snyk.js";
import { bold, dim, severityColor, table, truncate, relativeTime } from "../format.js";

export function register(program) {
  const cmd = program.command("snyk").description("Snyk security issues");

  // ── token ────────────────────────────────────────────────────────
  cmd
    .command("token")
    .description("Save a Snyk API token")
    .argument("<token>", "Snyk API token")
    .action((token) => {
      snyk.saveToken(token);
      console.log("✓ Snyk token saved.");
    });

  // ── issues ───────────────────────────────────────────────────────
  cmd
    .command("issues")
    .description("List open Snyk issues across organizations")
    .option("--severity <level>", "Filter by severity (critical, high, medium, low)")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const snapshot = await snyk.listOpenIssues({
          severity: opts.severity,
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

        const counts = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const i of issues) {
          const key = i.severity?.toLowerCase();
          if (key in counts) counts[key]++;
        }

        console.log(
          bold("Snyk Issues") +
            dim(
              ` (${issues.length} issues across ${organizationCount} orgs, ${projectCount} projects: ` +
                Object.entries(counts)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(", ") +
                ")\n"
            )
        );

        const rows = issues.map((i) => [
          severityColor(i.severity, i.severity.toUpperCase()),
          truncate(i.organizationName, 18),
          truncate(i.projectName, 22),
          truncate(i.title, 40),
          i.packageName ? truncate(i.packageName, 20) : dim("–"),
          i.issueType,
          relativeTime(i.updatedAt),
        ]);

        console.log(
          table(rows, {
            headers: ["Severity", "Org", "Project", "Title", "Package", "Type", "Updated"],
          })
        );
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });
}

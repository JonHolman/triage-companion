import * as github from "../clients/github.js";
import * as git from "../clients/git.js";
import * as snyk from "../clients/snyk.js";
import * as jira from "../clients/jira.js";
import { configFilePath } from "../credential-store.js";
import { bold, dim } from "../format.js";

export function register(program) {
  program
    .command("status")
    .description("Show configuration and availability status for all services")
    .action(() => {
      console.log(bold("Service Status\n"));
      const gitBinary = git.resolveGitBinary();

      const services = [
        {
          name: "GitHub",
          configured: github.hasToken(),
          hint: "triage-companion github token <token>",
          env: "GITHUB_TOKEN",
        },
        {
          name: "Snyk",
          configured: snyk.hasToken(),
          hint: "triage-companion snyk token <token>",
          env: "SNYK_TOKEN",
        },
        {
          name: "Jira",
          configured: jira.hasCredentials(),
          hint: "triage-companion jira credentials <url> <email> <token>",
          env: "JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN",
        },
        {
          name: "Git",
          configured: gitBinary !== null,
          availableLabel: "available",
          missingLabel: "not available",
          hint: "Install git or set TRIAGE_COMPANION_GIT",
          env: "TRIAGE_COMPANION_GIT",
        },
      ];

      for (const s of services) {
        const icon = s.configured ? "✓" : "✗";
        const status = s.configured
          ? (s.availableLabel ?? "configured")
          : (s.missingLabel ?? "not configured");
        console.log(`  ${icon} ${bold(s.name)}: ${status}`);
        if (!s.configured) {
          console.log(dim(`    Set up: ${s.hint}`));
          console.log(dim(`    Or env: ${s.env}`));
        }
      }

      console.log(dim(`\nCredentials are stored in ${configFilePath()}`));
    });
}

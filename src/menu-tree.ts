import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import * as github from "./clients/github.ts";
import * as jira from "./clients/jira.ts";
import * as snyk from "./clients/snyk.ts";
import { buildConfigurationSummary } from "./config-summary.ts";
import {
  clearSearchRoots,
  parseSearchRootsInput,
  readSearchRootsConfig,
  resolveSearchRoots,
  saveSearchRoots,
  searchRootsEnvOverrideState,
} from "./config.ts";
import { inlineErrorText } from "./commands/command-utils.ts";
import { textEnvOverrideState } from "./config-path.ts";
import { ENV, getServiceDefinition } from "./config-model.ts";
import { dim } from "./format.ts";
import { prompt, promptSecret } from "./menu-prompts.ts";
import { MenuActionReportedError, type MenuNode } from "./menu-types.ts";

const ENTRY_POINT = fileURLToPath(new URL("./index.ts", import.meta.url));

function printServiceSetup(serviceId: "github" | "snyk" | "jira"): void {
  const service = getServiceDefinition(serviceId);
  for (const note of service.status.setupGuidance) {
    console.log(dim(note));
  }
  for (const requirement of service.status.permissionRequirements) {
    console.log(dim(`${requirement.feature}: ${requirement.permissions.join(", ")}`));
  }
}

function runCli(args: string[]): void {
  const result = spawnSync(process.execPath, [ENTRY_POINT, ...args], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw new Error(`triage-companion failed to run ${args.join(" ")}: ${result.error.message}`);
  }

  if (result.signal) {
    throw new Error(`triage-companion ${args.join(" ")} exited on signal ${result.signal}.`);
  }

  if (result.status !== 0) {
    throw new MenuActionReportedError(
      `triage-companion ${args.join(" ")} exited with status ${result.status ?? "unknown"}.`,
    );
  }
}

function printSearchRootsOverrideMessage(savedRootsContext: "saved" | "defaults"): boolean {
  const state = searchRootsEnvOverrideState();
  if (state === "missing") {
    return false;
  }

  if (state === "invalid") {
    console.log(
      dim(
        `${ENV.GIT_SEARCH_ROOTS} is still set but invalid, so Git repository discovery will fail until it is fixed or unset.`,
      ),
    );
    return true;
  }

  console.log(dim(`${ENV.GIT_SEARCH_ROOTS} still overrides the ${savedRootsContext} when set.`));
  return true;
}

function printSnykAPIBaseURLOverrideMessage(context: "saved" | "default"): boolean {
  const state = snyk.apiBaseURLEnvOverrideState();
  if (state === "missing") {
    return false;
  }

  if (state === "invalid") {
    console.log(
      dim(
        `${ENV.SNYK_API_BASE_URL} is still set but invalid, so Snyk commands will fail until it is fixed or unset.`,
      ),
    );
    return true;
  }

  console.log(
    dim(
      context === "saved"
        ? `${ENV.SNYK_API_BASE_URL} still overrides the saved API base URL when set.`
        : `${ENV.SNYK_API_BASE_URL} still overrides the US-01 default when set.`,
    ),
  );
  return true;
}

function printJiraBaseURLOverrideMessage(context: "saved" | "effective"): boolean {
  const state = jira.baseURLEnvOverrideState();
  if (state === "missing") {
    return false;
  }

  if (state === "invalid") {
    console.log(
      dim(
        `${ENV.JIRA_BASE_URL} is still set but invalid, so Jira commands will fail until it is fixed or unset.`,
      ),
    );
    return true;
  }

  console.log(
    dim(
      context === "saved"
        ? `${ENV.JIRA_BASE_URL} still overrides the saved Jira base URL when set.`
        : `${ENV.JIRA_BASE_URL} still provides the effective Jira base URL when set.`,
    ),
  );
  return true;
}

function printTextEnvOverrideMessage(
  envVar: string,
  validMessage: string,
  invalidMessage: string,
): boolean {
  const state = textEnvOverrideState(process.env[envVar]);
  if (state === "missing") {
    return false;
  }

  console.log(dim(state === "invalid" ? invalidMessage : validMessage));
  return true;
}

async function setGitHubToken(): Promise<void> {
  printServiceSetup("github");
  const token = await promptSecret("GitHub token: ");
  if (!token) {
    return;
  }

  github.saveToken(token);
  console.log("GitHub token saved.");
}

function removeGitHubToken(): void {
  github.removeToken();
  console.log("GitHub token removed.");
  printTextEnvOverrideMessage(
    ENV.GITHUB_TOKEN,
    `${ENV.GITHUB_TOKEN} still provides the effective GitHub token when set.`,
    `${ENV.GITHUB_TOKEN} is still set but invalid, so GitHub commands will fail until it is fixed or unset.`,
  );
}

async function listGitHubSecurityAlerts(): Promise<void> {
  const repos = await prompt(
    "Repository full names (owner/repo, space-separated; blank for notification repos): ",
  );
  runCli(["github", "security-alerts", ...repos.split(/\s+/).filter(Boolean)]);
}

async function listGitHubOpenPullRequestsWithLogin(): Promise<void> {
  const login = await prompt("GitHub login override (blank to cancel): ");
  if (!login.trim()) {
    return;
  }

  runCli(["github", "my-open-prs", "--github-login", login]);
}

async function listGitHubOpenPullRequestsWithAuthorRegex(): Promise<void> {
  const pattern = await prompt("Author regex override (blank to cancel): ");
  if (!pattern.trim()) {
    return;
  }

  runCli(["github", "my-open-prs", "--author-regex", pattern]);
}

async function setSnykToken(): Promise<void> {
  printServiceSetup("snyk");
  const token = await promptSecret("Snyk token: ");
  if (!token) {
    return;
  }

  snyk.saveToken(token);
  console.log("Snyk token saved.");
}

function removeSnykToken(): void {
  snyk.removeToken();
  console.log("Snyk token removed.");
  printTextEnvOverrideMessage(
    ENV.SNYK_TOKEN,
    "SNYK_TOKEN still provides the effective Snyk token when set.",
    "SNYK_TOKEN is still set but invalid, so Snyk commands will fail until it is fixed or unset.",
  );
}

async function setSnykAPIBaseURL(): Promise<void> {
  printServiceSetup("snyk");
  let current = "https://api.snyk.io/rest";
  try {
    current = snyk.currentAPIBaseURL();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(dim(inlineErrorText(message)));
  }

  const input = await prompt(`Snyk API base URL [${current}]: `);
  if (!input) {
    return;
  }

  const saved = snyk.saveAPIBaseURL(input);
  console.log(`Snyk API base URL saved: ${saved}`);
  printSnykAPIBaseURLOverrideMessage("saved");
}

async function resetSnykAPIBaseURL(): Promise<void> {
  snyk.removeAPIBaseURL();
  console.log("Stored Snyk API base URL reset.");
  printSnykAPIBaseURLOverrideMessage("default");
}

async function listSnykIssuesBySeverity(): Promise<void> {
  const severity = await prompt("Severity (critical, high, medium, low): ");
  if (!severity) {
    return;
  }

  runCli(["snyk", "issues", "--severity", severity]);
}

async function setJiraCredentials(): Promise<void> {
  printServiceSetup("jira");
  const baseURL = await prompt("Jira base URL (for example https://your-company.atlassian.net): ");
  const email = await prompt("Jira email: ");
  const token = await promptSecret("Jira API token: ");
  if (!baseURL || !email || !token) {
    return;
  }

  jira.saveCredentials(baseURL, email, token);
  console.log("Jira credentials saved.");
  printJiraBaseURLOverrideMessage("saved");
  printTextEnvOverrideMessage(
    ENV.JIRA_EMAIL,
    `${ENV.JIRA_EMAIL} still overrides the saved Jira email when set.`,
    `${ENV.JIRA_EMAIL} is still set but invalid, so Jira commands will fail until it is fixed or unset.`,
  );
  printTextEnvOverrideMessage(
    ENV.JIRA_API_TOKEN,
    `${ENV.JIRA_API_TOKEN} still overrides the saved Jira API token when set.`,
    `${ENV.JIRA_API_TOKEN} is still set but invalid, so Jira commands will fail until it is fixed or unset.`,
  );
}

function removeJiraCredentials(): void {
  jira.removeCredentials();
  console.log("Jira credentials removed.");
  printJiraBaseURLOverrideMessage("effective");
  printTextEnvOverrideMessage(
    ENV.JIRA_EMAIL,
    `${ENV.JIRA_EMAIL} still provides the effective Jira email when set.`,
    `${ENV.JIRA_EMAIL} is still set but invalid, so Jira commands will fail until it is fixed or unset.`,
  );
  printTextEnvOverrideMessage(
    ENV.JIRA_API_TOKEN,
    `${ENV.JIRA_API_TOKEN} still provides the effective Jira API token when set.`,
    `${ENV.JIRA_API_TOKEN} is still set but invalid, so Jira commands will fail until it is fixed or unset.`,
  );
}

async function editSearchRoots(): Promise<void> {
  let current: string[] = [];
  try {
    current = readSearchRootsConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(dim(inlineErrorText(message)));
  }

  const initial = current.length > 0 ? JSON.stringify(current) : "";
  const input = await prompt(
    `Git search roots as a JSON array${initial ? ` [${initial}]` : ""} (blank to cancel): `,
  );
  if (input.trim().length === 0) {
    return;
  }

  const roots = parseSearchRootsInput(input);
  const savedRoots = saveSearchRoots(roots);
  if (roots.length === 0) {
    if (searchRootsEnvOverrideState() !== "missing") {
      console.log("Stored Git search roots cleared.");
      printSearchRootsOverrideMessage("defaults");
      return;
    }

    console.log("Git search roots reset to defaults.");
    return;
  }

  console.log(`Git search roots saved: ${savedRoots.join(", ")}`);
  const effectiveRoots = resolveSearchRoots(JSON.stringify(savedRoots));
  if (effectiveRoots.length !== roots.length) {
    if (effectiveRoots.length === 0) {
      console.log(
        "None of the saved roots currently exist as directories, so Git repository discovery will return no repositories.",
      );
    } else {
      console.log("Some saved roots do not currently exist as directories and will be ignored.");
    }
  }
  printSearchRootsOverrideMessage("saved");
}

async function clearSearchRootsSetting(): Promise<void> {
  clearSearchRoots();
  if (searchRootsEnvOverrideState() !== "missing") {
    console.log("Stored Git search roots cleared.");
    printSearchRootsOverrideMessage("defaults");
    return;
  }

  console.log("Git search roots reset to defaults.");
}

export function buildMenuTree(): MenuNode {
  return {
    title: "triage-companion",
    items: [
      {
        label: "Status",
        action: () => runCli(["status"]),
      },
      {
        label: "GitHub",
        submenu: {
          title: "GitHub",
          items: [
            { label: "List notifications", action: () => runCli(["github", "notifications"]) },
            {
              label: "Mark notification read",
              action: async () => {
                const id = await prompt("Notification thread ID: ");
                if (id) {
                  runCli(["github", "mark-read", id]);
                }
              },
            },
            { label: "List my open PRs", action: () => runCli(["github", "my-open-prs"]) },
            {
              label: "List my open PRs with login override",
              action: listGitHubOpenPullRequestsWithLogin,
            },
            {
              label: "List my open PRs with author regex",
              action: listGitHubOpenPullRequestsWithAuthorRegex,
            },
            {
              label: "List security alerts",
              action: listGitHubSecurityAlerts,
            },
            {
              label: "List failed workflows",
              action: async () => {
                const repos = await prompt(
                  "Repository full names (owner/repo, space-separated; blank for current repo): ",
                );
                runCli(["github", "failed-workflows", ...repos.split(/\s+/).filter(Boolean)]);
              },
            },
            { label: "Set token", action: setGitHubToken },
            { label: "Replace token", action: setGitHubToken },
            { label: "Remove token", action: removeGitHubToken },
            { label: "Back" },
          ],
        },
      },
      {
        label: "Snyk",
        submenu: {
          title: "Snyk",
          items: [
            { label: "List issues", action: () => runCli(["snyk", "issues"]) },
            { label: "List issues by severity", action: listSnykIssuesBySeverity },
            { label: "Set API base URL", action: setSnykAPIBaseURL },
            { label: "Reset API base URL", action: resetSnykAPIBaseURL },
            { label: "Set token", action: setSnykToken },
            { label: "Replace token", action: setSnykToken },
            { label: "Remove token", action: removeSnykToken },
            { label: "Back" },
          ],
        },
      },
      {
        label: "Jira",
        submenu: {
          title: "Jira",
          items: [
            { label: "List tickets", action: () => runCli(["jira", "tickets"]) },
            { label: "Set credentials", action: setJiraCredentials },
            { label: "Replace credentials", action: setJiraCredentials },
            { label: "Remove credentials", action: removeJiraCredentials },
            { label: "Back" },
          ],
        },
      },
      {
        label: "Git",
        submenu: {
          title: "Git",
          items: [
            { label: "List dirty repositories", action: () => runCli(["git", "dirty"]) },
            { label: "Show full git status", action: () => runCli(["git", "status"]) },
            { label: "Back" },
          ],
        },
      },
      {
        label: "Configuration",
        submenu: {
          title: "Configuration",
          items: [
            {
              label: "View configuration",
              action: () => process.stdout.write(buildConfigurationSummary()),
            },
            { label: "Edit git search roots", action: editSearchRoots },
            { label: "Reset git search roots", action: clearSearchRootsSetting },
            { label: "Back" },
          ],
        },
      },
      { label: "Exit" },
    ],
  };
}

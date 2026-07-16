import { spawn } from "node:child_process";
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
import { inlineErrorText, startActivityNotice, SUPPRESS_ACTIVITY_ENV } from "./commands/command-utils.ts";
import { textEnvOverrideState } from "./config-path.ts";
import { ENV, getServiceDefinition } from "./config-model.ts";
import { dim } from "./format.ts";
import {
  assignJiraTicketToSprint,
  changeJiraTicketStatus,
  commentOnJiraTicket,
  createJiraTicket,
} from "./menu-jira-actions.ts";
import {
  listGitHubFailedWorkflows,
  listGitHubNotifications,
  listGitHubOpenPullRequests,
  listGitHubOpenPullRequestsWithAuthorRegex,
  listGitHubOpenPullRequestsWithLogin,
  listGitHubSecurityAlerts,
  listJiraTickets,
  listSnykIssues,
  listSnykIssuesBySeverity,
} from "./menu-list-actions.ts";
import { prompt, promptSecret } from "./menu-prompts.ts";
import { MenuActionReportedError, type MenuItem, type MenuNode } from "./menu-types.ts";

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

async function runCli(args: string[]): Promise<void> {
  const label = args.join(" ");
  const activityNotice = startActivityNotice(label);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY_POINT, ...args], {
      stdio: "inherit",
      env: { ...process.env, [SUPPRESS_ACTIVITY_ENV]: "1" },
    });

    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => activityNotice?.stop());

  if (result.signal) {
    throw new Error(`triage-companion ${label} exited on signal ${result.signal}.`);
  }

  if (result.code !== 0) {
    throw new MenuActionReportedError(`triage-companion ${label} exited with status ${result.code}.`);
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

function printJiraCloudIDOverrideMessage(context: "saved" | "effective"): boolean {
  const state = jira.cloudIDEnvOverrideState();
  if (state === "missing") {
    return false;
  }

  if (state === "invalid") {
    console.log(
      dim(
        `${ENV.JIRA_CLOUD_ID} is still set but invalid, so Jira commands will fail until it is fixed or unset.`,
      ),
    );
    return true;
  }

  console.log(
    dim(
      context === "saved"
        ? `${ENV.JIRA_CLOUD_ID} still overrides the saved Jira Cloud ID when set.`
        : `${ENV.JIRA_CLOUD_ID} still provides the effective Jira Cloud ID when set.`,
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

async function confirmCredentialRemoval(label: string): Promise<boolean> {
  const confirmation = await prompt(`Type remove to delete saved ${label} (blank, Esc, or q to cancel): `);
  if (confirmation !== "remove") {
    console.log(`${label} removal canceled.`);
    return false;
  }

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

async function removeGitHubToken(): Promise<void> {
  if (!(await confirmCredentialRemoval("GitHub token"))) {
    return;
  }

  github.removeToken();
  console.log("GitHub token removed.");
  printTextEnvOverrideMessage(
    ENV.GITHUB_TOKEN,
    `${ENV.GITHUB_TOKEN} still provides the effective GitHub token when set.`,
    `${ENV.GITHUB_TOKEN} is still set but invalid, so GitHub commands will fail until it is fixed or unset.`,
  );
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

async function removeSnykToken(): Promise<void> {
  if (!(await confirmCredentialRemoval("Snyk token"))) {
    return;
  }

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
  let current: string | null = null;
  try {
    current = snyk.currentAPIBaseURL();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(dim(inlineErrorText(message)));
  }

  const input = await prompt(`Snyk API base URL${current === null ? "" : ` [${current}]`}: `);
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

async function setJiraCredentials(): Promise<void> {
  printServiceSetup("jira");
  const baseURL = await prompt("Jira base URL (for example https://your-company.atlassian.net): ");
  const email = await prompt("Jira email: ");
  const token = await promptSecret("Jira API token: ");
  const cloudID = await prompt("Jira Cloud ID for scoped tokens (optional): ");
  if (!baseURL || !email || !token) {
    return;
  }

  jira.saveCredentials(baseURL, email, token, cloudID || undefined);
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
  printJiraCloudIDOverrideMessage("saved");
}

async function removeJiraCredentials(): Promise<void> {
  if (!(await confirmCredentialRemoval("Jira credentials"))) {
    return;
  }

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
  printJiraCloudIDOverrideMessage("effective");
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

function buildGitHubMenu(): MenuNode {
  const items: MenuItem[] = [
    { label: "List my open PRs", action: listGitHubOpenPullRequests },
    {
      label: "List my open PRs with login override",
      action: listGitHubOpenPullRequestsWithLogin,
    },
    {
      label: "List my open PRs with author regex",
      action: listGitHubOpenPullRequestsWithAuthorRegex,
    },
  ];

  if (github.hasToken()) {
    items.unshift(
      { label: "List notifications", action: listGitHubNotifications },
      {
        label: "Mark notification read",
        action: async () => {
          const id = await prompt("Notification thread ID: ");
          if (id) {
            await runCli(["github", "mark-read", id]);
          }
        },
      },
    );
    items.push(
      { label: "List security alerts", action: listGitHubSecurityAlerts },
      { label: "List failed workflows", action: listGitHubFailedWorkflows },
    );
  }

  items.push({ label: "Back" });

  return {
    title: "GitHub",
    items,
  };
}

function buildSnykMenu(): MenuNode {
  return {
    title: "Snyk",
    items: [
      { label: "List issues", action: listSnykIssues },
      { label: "List issues by severity", action: listSnykIssuesBySeverity },
      { label: "Back" },
    ],
  };
}

function buildJiraMenu(): MenuNode {
  return {
    title: "Jira",
    items: [
      { label: "List tickets", action: listJiraTickets },
      { label: "Create ticket", action: createJiraTicket },
      { label: "Comment on ticket", action: commentOnJiraTicket },
      { label: "Assign ticket to sprint", action: assignJiraTicketToSprint },
      { label: "Change ticket status", action: changeJiraTicketStatus },
      { label: "Back" },
    ],
  };
}

function buildConfigurationMenu(): MenuNode {
  return {
    title: "Configuration",
    items: [
      { label: "View configuration", action: () => { process.stdout.write(buildConfigurationSummary()); } },
      { label: "Set or replace GitHub token", action: setGitHubToken },
      { label: "Remove GitHub token", action: removeGitHubToken },
      { label: "Set or replace Snyk token", action: setSnykToken },
      { label: "Remove Snyk token", action: removeSnykToken },
      { label: "Set Snyk API base URL", action: setSnykAPIBaseURL },
      { label: "Reset Snyk API base URL", action: resetSnykAPIBaseURL },
      { label: "Set or replace Jira credentials", action: setJiraCredentials },
      { label: "Remove Jira credentials", action: removeJiraCredentials },
      { label: "Edit git search roots", action: editSearchRoots },
      { label: "Reset git search roots", action: clearSearchRootsSetting },
      { label: "Back" },
    ],
  };
}

export function buildMenuTree(): MenuNode {
  const items: MenuItem[] = [
    { label: "Status", action: () => runCli(["status"]) },
    { label: "GitHub", submenu: buildGitHubMenu() },
  ];
  if (snyk.hasToken()) {
    items.push({ label: "Snyk", submenu: buildSnykMenu() });
  }
  if (jira.hasCredentials()) {
    items.push({ label: "Jira", submenu: buildJiraMenu() });
  }
  items.push(
    {
      label: "Git",
      submenu: { title: "Git", items: [
        { label: "List dirty repositories", action: () => runCli(["git", "dirty"]) },
        { label: "Show full git status", action: () => runCli(["git", "status"]) },
        { label: "Back" },
      ] },
    },
    { label: "Configuration", submenu: buildConfigurationMenu() },
    { label: "Exit" },
  );

  return {
    title: "triage-companion",
    items,
    refresh: buildMenuTree,
  };
}

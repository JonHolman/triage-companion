import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import readline from "node:readline";

import * as github from "./clients/github.ts";
import * as jira from "./clients/jira.ts";
import * as snyk from "./clients/snyk.ts";
import { buildConfigurationSummary } from "./config-summary.ts";
import {
  clearSearchRoots,
  parseSearchRootsInput,
  resolveSearchRoots,
  saveSearchRoots,
  readSearchRootsConfig,
  searchRootsEnvOverrideState,
} from "./config.ts";
import { inlineErrorText } from "./commands/command-utils.ts";
import { textEnvOverrideState } from "./config-path.ts";
import { ENV, getServiceDefinition } from "./config-model.ts";
import { dim } from "./format.ts";

type MenuAction = () => Promise<void> | void;

interface MenuItem {
  label: string;
  action?: MenuAction;
  submenu?: MenuNode;
}

interface MenuNode {
  title: string;
  items: MenuItem[];
}

export class MenuActionReportedError extends Error {}
export class MenuInterruptedError extends Error {}

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

  console.log(
    dim(
      `${ENV.GIT_SEARCH_ROOTS} still overrides the ${savedRootsContext} when set.`,
    ),
  );
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

async function prompt(text: string): Promise<string> {
  const wasRaw = Boolean(process.stdin.isTTY && process.stdin.isRaw);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(text, (value) => resolve(value));
  });

  rl.close();
  if (process.stdin.isTTY && wasRaw) {
    process.stdin.setRawMode(true);
  }

  return answer;
}

async function promptSecret(text: string): Promise<string> {
  const wasRaw = Boolean(process.stdin.isTTY && process.stdin.isRaw);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  process.stdout.write(text);
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: sink,
    terminal: true,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question("", (value) => resolve(value));
  });

  rl.close();
  process.stdout.write("\n");
  if (process.stdin.isTTY && wasRaw) {
    process.stdin.setRawMode(true);
  }

  return answer;
}

function pause(): Promise<void> {
  return prompt(dim("Press Enter to continue... ")).then(() => undefined);
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
  const repos = await prompt("Repository full names (owner/repo, space-separated; blank for notification repos): ");
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
      console.log("None of the saved roots currently exist as directories, so Git repository discovery will return no repositories.");
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

function buildMenuTree(): MenuNode {
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
                const repos = await prompt("Repository full names (owner/repo, space-separated; blank for current repo): ");
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
            { label: "View configuration", action: () => process.stdout.write(buildConfigurationSummary()) },
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

function renderMenu(node: MenuNode, selected: number): void {
  process.stdout.write("\x1b[2J\x1b[H");
  console.log(node.title);
  console.log("");
  for (const [index, item] of node.items.entries()) {
    const prefix = index === selected ? ">" : " ";
    const line = `${prefix} ${item.label}`;
    console.log(index === selected ? `\x1b[7m${line}\x1b[0m` : line);
  }
  console.log("");
  console.log("Use arrow keys and Enter. Esc or q goes back.");
}

export function isMenuInterruptKey(key: readline.Key): boolean {
  return key.ctrl === true && key.name === "c";
}

async function activateItem(item: MenuItem): Promise<void> {
  if (item.submenu) {
    await openMenu(item.submenu);
    return;
  }

  if (item.action) {
    await runMenuAction(item);
    await pause();
  }
}

async function runMenuAction(item: MenuItem): Promise<void> {
  if (!item.action) {
    return;
  }

  try {
    await item.action();
  } catch (error) {
    if (error instanceof MenuActionReportedError) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`triage-companion menu error: ${inlineErrorText(message)}\n`);
  }
}

async function openMenu(node: MenuNode): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive menu requires a TTY.");
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  let selected = 0;
  let done = false;

  try {
    while (!done) {
      renderMenu(node, selected);

      const key = await new Promise<readline.Key>((resolve) => {
        const onKey = (_str: string, info: readline.Key): void => {
          process.stdin.off("keypress", onKey);
          resolve(info);
        };

        process.stdin.on("keypress", onKey);
      });

      if (key.name === "up") {
        selected = (selected - 1 + node.items.length) % node.items.length;
        continue;
      }

      if (isMenuInterruptKey(key)) {
        throw new MenuInterruptedError();
      }

      if (key.name === "down") {
        selected = (selected + 1) % node.items.length;
        continue;
      }

      if (key.name === "return") {
        const item = node.items[selected];
        if (!item) {
          continue;
        }

        if (item.label === "Back" || item.label === "Exit") {
          done = true;
          continue;
        }

        process.stdin.setRawMode(false);
        try {
          await activateItem(item);
        } finally {
          process.stdin.setRawMode(true);
        }

        continue;
      }

      if (key.name === "escape" || key.sequence === "q") {
        done = true;
      }
    }
  } finally {
    process.stdin.setRawMode(false);
  }
}

export async function runInteractiveMenu(): Promise<void> {
  await openMenu(buildMenuTree());
}

export { buildMenuTree, runMenuAction };

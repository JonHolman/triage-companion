#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface GitHubUser {
  login: string;
}

interface GitHubRepository {
  name: string;
  full_name: string;
}

interface GitHubRef {
  object: {
    sha: string;
  };
}

interface JiraUser {
  accountId: string;
}

interface JiraProject {
  key: string;
  issueTypes?: Array<{
    id: string;
    name: string;
    subtask: boolean;
  }>;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required. Add it to ~/data/triage-companion-demo/demo.env.`);
  }

  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? null : value;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 15);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function printShellExports(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  }).replace(/[\r\n]+$/, "");
}

async function parseResponseJSON<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${text.replace(/\s+/g, " ").slice(0, 500)}`);
  }

  return JSON.parse(text) as T;
}

async function githubRequest<T>(
  token: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`https://api.github.com${route}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "triage-companion-demo",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  return parseResponseJSON<T>(response, `GitHub ${method} ${route}`);
}

function githubContentPath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

async function putGitHubFile(
  token: string,
  repository: string,
  branch: string,
  filePath: string,
  content: string,
  message: string,
): Promise<void> {
  await githubRequest(token, "PUT", `/repos/${repository}/contents/${githubContentPath(filePath)}`, {
    message,
    branch,
    content: Buffer.from(content).toString("base64"),
  });
}

async function seedGitHub(
  setupToken: string,
  runId: string,
  vulnerablePackageJSON: string,
  vulnerablePackageLock: string,
): Promise<{ login: string; repository: string }> {
  const user = await githubRequest<GitHubUser>(setupToken, "GET", "/user");
  const repoName = `triage-companion-demo-${runId.toLowerCase()}`;
  const repo = await githubRequest<GitHubRepository>(setupToken, "POST", "/user/repos", {
    name: repoName,
    private: false,
    auto_init: false,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
  });

  const repository = repo.full_name;
  const mainBranch = "main";
  await putGitHubFile(
    setupToken,
    repository,
    mainBranch,
    "README.md",
    [
      "# Triage Companion Demo",
      "",
      "This repository is generated for a terminal demo.",
      "",
    ].join("\n"),
    "add demo readme",
  );
  await putGitHubFile(setupToken, repository, mainBranch, "package.json", vulnerablePackageJSON, "add demo package");
  await putGitHubFile(
    setupToken,
    repository,
    mainBranch,
    "package-lock.json",
    vulnerablePackageLock,
    "add demo lockfile",
  );
  await githubRequest(setupToken, "PUT", `/repos/${repository}/vulnerability-alerts`);

  const mainRef = await githubRequest<GitHubRef>(setupToken, "GET", `/repos/${repository}/git/ref/heads/${mainBranch}`);
  const prBranch = "demo-open-pr";
  await githubRequest(setupToken, "POST", `/repos/${repository}/git/refs`, {
    ref: `refs/heads/${prBranch}`,
    sha: mainRef.object.sha,
  });
  await putGitHubFile(
    setupToken,
    repository,
    prBranch,
    "triage-notes.md",
    [
      "# Demo PR",
      "",
      "This branch gives `github my-open-prs` a live pull request to discover.",
      "",
    ].join("\n"),
    "add demo pr notes",
  );
  await githubRequest(setupToken, "POST", `/repos/${repository}/pulls`, {
    title: "Demo triage pull request",
    head: prBranch,
    base: mainBranch,
    body: "Generated for the triage-companion terminal demo.",
  });

  if (optionalEnv("TRIAGE_COMPANION_DEMO_RUN_GITHUB_ACTIONS") === "1") {
    await putGitHubFile(
      setupToken,
      repository,
      mainBranch,
      ".github/workflows/demo-failure.yml",
      [
        "name: Demo failure",
        "",
        "on:",
        "  workflow_dispatch:",
        "",
        "jobs:",
        "  demo:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: exit 1",
        "",
      ].join("\n"),
      "add demo workflow",
    );
    await githubRequest(setupToken, "POST", `/repos/${repository}/actions/workflows/demo-failure.yml/dispatches`, {
      ref: mainBranch,
    });
  }

  const actorToken = optionalEnv("TRIAGE_COMPANION_DEMO_GITHUB_ACTOR_TOKEN");
  if (actorToken !== null) {
    await githubRequest(actorToken, "POST", `/repos/${repository}/issues`, {
      title: "Demo notification",
      body: `@${user.login} this issue exists so the terminal demo can show a GitHub notification.`,
    });
  }

  return { login: user.login, repository };
}

function writeVulnerablePackage(projectDirectory: string): { packageJSON: string; packageLock: string } {
  fs.mkdirSync(projectDirectory, { recursive: true });
  const packageJSON = JSON.stringify({
    name: "triage-companion-demo-vulnerable-package",
    version: "1.0.0",
    private: true,
    dependencies: {
      lodash: "4.17.15",
      minimist: "0.0.8",
    },
  }, null, 2) + "\n";
  fs.writeFileSync(path.join(projectDirectory, "package.json"), packageJSON, { mode: 0o600 });
  run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--fund=false"], {
    cwd: projectDirectory,
  });

  const packageLock = fs.readFileSync(path.join(projectDirectory, "package-lock.json"), "utf-8");
  return { packageJSON, packageLock };
}

function seedLocalGitRepositories(reposRoot: string, githubRepository: string): { localDirtyRepo: string; localGitHubRepo: string } {
  const localDirtyRepo = path.join(reposRoot, "demo-dirty-repo");
  fs.mkdirSync(localDirtyRepo, { recursive: true });
  run("git", ["init"], { cwd: localDirtyRepo });
  run("git", ["config", "user.name", "Triage Companion Demo"], { cwd: localDirtyRepo });
  run("git", ["config", "user.email", "triage-companion-demo@jonholman.com"], { cwd: localDirtyRepo });
  fs.writeFileSync(path.join(localDirtyRepo, "README.md"), "# Demo dirty repo\n", { mode: 0o600 });
  run("git", ["add", "README.md"], { cwd: localDirtyRepo });
  run("git", ["commit", "-m", "initial demo commit"], { cwd: localDirtyRepo });
  fs.writeFileSync(path.join(localDirtyRepo, "README.md"), "# Demo dirty repo\n\nUncommitted demo change.\n", { mode: 0o600 });
  fs.writeFileSync(path.join(localDirtyRepo, "notes.txt"), "untracked demo note\n", { mode: 0o600 });

  const localGitHubRepo = path.join(reposRoot, "demo-github-pr-repo");
  fs.mkdirSync(localGitHubRepo, { recursive: true });
  run("git", ["init"], { cwd: localGitHubRepo });
  run("git", ["remote", "add", "origin", `https://github.com/${githubRepository}.git`], { cwd: localGitHubRepo });

  return { localDirtyRepo, localGitHubRepo };
}

function seedSnyk(projectDirectory: string, projectName: string, repository: string): void {
  run("npm", [
    "exec",
    "--yes",
    "snyk",
    "--",
    "monitor",
    `--project-name=${projectName}`,
    "--target-reference=demo",
    "--strict-out-of-sync=false",
    `--remote-repo-url=https://github.com/${repository}.git`,
  ], {
    cwd: projectDirectory,
    env: {
      SNYK_TOKEN: requiredEnv("TRIAGE_COMPANION_DEMO_SNYK_TOKEN"),
    },
  });
}

async function jiraRequest<T>(
  baseURL: string,
  email: string,
  token: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseURL}${route}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      Accept: "application/json",
      "User-Agent": "triage-companion-demo",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  return parseResponseJSON<T>(response, `Jira ${method} ${route}`);
}

async function jiraProjectExists(baseURL: string, email: string, token: string, projectKey: string): Promise<boolean> {
  const response = await fetch(`${baseURL}/rest/api/3/project/${encodeURIComponent(projectKey)}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      Accept: "application/json",
      "User-Agent": "triage-companion-demo",
    },
    redirect: "error",
  });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jira project lookup failed with HTTP ${response.status}: ${text.replace(/\s+/g, " ").slice(0, 500)}`);
  }

  return true;
}

async function seedJira(runId: string): Promise<{ projectKey: string; issueKey: string }> {
  const baseURL = requiredEnv("TRIAGE_COMPANION_DEMO_JIRA_BASE_URL").replace(/\/+$/, "");
  const email = requiredEnv("TRIAGE_COMPANION_DEMO_JIRA_EMAIL");
  const cloudID = optionalEnv("TRIAGE_COMPANION_DEMO_JIRA_CLOUD_ID");
  const apiBaseURL = cloudID === null ? baseURL : `https://api.atlassian.com/ex/jira/${cloudID}`;
  const token = optionalEnv("TRIAGE_COMPANION_DEMO_JIRA_SETUP_API_TOKEN") ?? requiredEnv("TRIAGE_COMPANION_DEMO_JIRA_API_TOKEN");
  const projectKey = optionalEnv("TRIAGE_COMPANION_DEMO_JIRA_PROJECT_KEY") ?? "TCD";
  const user = await jiraRequest<JiraUser>(apiBaseURL, email, token, "GET", "/rest/api/3/myself");

  if (!(await jiraProjectExists(apiBaseURL, email, token, projectKey))) {
    await jiraRequest(apiBaseURL, email, token, "POST", "/rest/api/3/project", {
      key: projectKey,
      name: "Triage Companion Demo",
      projectTypeKey: "software",
      projectTemplateKey: "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic",
      leadAccountId: user.accountId,
      assigneeType: "PROJECT_LEAD",
    });
  }

  const project = await jiraRequest<JiraProject>(
    apiBaseURL,
    email,
    token,
    "GET",
    `/rest/api/3/project/${encodeURIComponent(projectKey)}?expand=issueTypes`,
  );
  const issueType = project.issueTypes?.find((item) => item.name === "Task" && !item.subtask);
  if (!issueType) {
    throw new Error(`Jira project ${projectKey} does not expose the Task issue type.`);
  }

  const issue = await jiraRequest<{ key: string }>(apiBaseURL, email, token, "POST", "/rest/api/3/issue", {
    fields: {
      project: { key: projectKey },
      summary: `Demo triage ticket ${runId}`,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Generated for the triage-companion terminal demo.",
              },
            ],
          },
        ],
      },
      issuetype: { id: issueType.id },
      assignee: { accountId: user.accountId },
    },
  });

  return { projectKey, issueKey: issue.key };
}

async function main(): Promise<void> {
  const shellMode = process.argv.includes("--shell");
  const setupToken = requiredEnv("TRIAGE_COMPANION_DEMO_GITHUB_SETUP_TOKEN");
  requiredEnv("TRIAGE_COMPANION_DEMO_GITHUB_RUNTIME_TOKEN");
  requiredEnv("TRIAGE_COMPANION_DEMO_SNYK_TOKEN");
  requiredEnv("TRIAGE_COMPANION_DEMO_JIRA_BASE_URL");
  requiredEnv("TRIAGE_COMPANION_DEMO_JIRA_EMAIL");
  requiredEnv("TRIAGE_COMPANION_DEMO_JIRA_API_TOKEN");

  const runId = `${timestamp()}-${randomUUID().slice(0, 8)}`;
  const runsDirectory = path.join(os.homedir(), "data", "triage-companion-demo", "runs");
  fs.mkdirSync(runsDirectory, { recursive: true, mode: 0o700 });
  const root = fs.mkdtempSync(path.join(runsDirectory, `${runId}-`));
  const configDirectory = path.join(root, "config");
  const reposRoot = path.join(root, "repos");
  const snykProjectDirectory = path.join(root, "snyk-vulnerable-package");
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(reposRoot, { recursive: true, mode: 0o700 });

  const vulnerableProject = writeVulnerablePackage(snykProjectDirectory);
  const github = await seedGitHub(
    setupToken,
    runId,
    vulnerableProject.packageJSON,
    vulnerableProject.packageLock,
  );
  const localRepos = seedLocalGitRepositories(reposRoot, github.repository);
  seedSnyk(snykProjectDirectory, `triage-companion-demo-${runId}`, github.repository);
  const jira = await seedJira(runId);

  const exports = {
    TRIAGE_COMPANION_DEMO_ROOT: root,
    TRIAGE_COMPANION_DEMO_REPOS_ROOT: reposRoot,
    TRIAGE_COMPANION_DEMO_LOCAL_REPO: localRepos.localGitHubRepo,
    TRIAGE_COMPANION_DEMO_DIRTY_REPO: localRepos.localDirtyRepo,
    TRIAGE_COMPANION_DEMO_GITHUB_LOGIN: github.login,
    TRIAGE_COMPANION_DEMO_GITHUB_REPOSITORY: github.repository,
    TRIAGE_COMPANION_DEMO_JIRA_PROJECT_KEY: jira.projectKey,
    TRIAGE_COMPANION_DEMO_JIRA_ISSUE_KEY: jira.issueKey,
    TRIAGE_COMPANION_CONFIG_DIR: configDirectory,
    TRIAGE_COMPANION_GIT_SEARCH_ROOTS: JSON.stringify([reposRoot]),
  };

  if (shellMode) {
    printShellExports(exports);
    return;
  }

  for (const [key, value] of Object.entries(exports)) {
    console.log(`${key}=${value}`);
  }
}

await main();

import {
  hasCanonicalTextValue as isTextValue,
  inlineErrorText,
  isRecord,
  recordField,
  validateConfiguredText,
} from "../text.ts";
import {
  USER_AGENT,
  authHeader,
  jiraAPIBaseURL,
  jiraAPIKind,
  jiraErrorMessage,
  parseJiraJSON,
  requireSettings,
  type JiraSettings,
} from "./jira.ts";

export interface CreateJiraTicketOptions {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string | null;
}

export interface CreatedJiraTicket {
  id: string;
  key: string;
  url: string;
}

export interface JiraCommentResult {
  id: string;
  issueKey: string;
}

export interface JiraStatusChangeResult {
  issueKey: string;
  status: string;
}

interface JiraTransitionOption {
  id: string;
  targetStatus: string;
}

function jiraIssueBasePath(settings: JiraSettings): string {
  return jiraAPIKind(settings) === "data-center" ? "/rest/api/2/issue" : "/rest/api/3/issue";
}

function jiraIssuePath(settings: JiraSettings, issueKey: string, suffix = ""): string {
  return `${jiraIssueBasePath(settings)}/${encodeURIComponent(issueKey)}${suffix}`;
}

function jiraSprintIssuePath(sprintID: string): string {
  return `/rest/agile/1.0/sprint/${encodeURIComponent(sprintID)}/issue`;
}

function validateIssueKeyResponse(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(value)) {
    throw new Error("Jira create issue response included an invalid issue key.");
  }

  return value.toUpperCase();
}

function validateIssueKeyArgument(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(value)) {
    throw new Error("Jira issue key must use project-key-number format.");
  }

  return value.toUpperCase();
}

function validateProjectKey(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("Jira project key must include only letters, digits, and underscores, and start with a letter.");
  }

  return value.toUpperCase();
}

function validateSprintID(value: string): string {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("Jira sprint ID must be a positive integer.");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Jira sprint ID must be a positive integer.");
  }

  return String(parsed);
}

async function requestJira(
  settings: JiraSettings,
  responseName: string,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  okStatuses: readonly number[],
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: authHeader(settings),
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  const init: RequestInit = {
    method,
    redirect: "error",
    headers,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${jiraAPIBaseURL(settings)}${path}`, init);
  } catch (error) {
    const message = inlineErrorText(error instanceof Error ? error.message : String(error));
    throw new Error(`Could not load ${responseName}: ${message}`, {
      cause: error,
    });
  }

  if (!okStatuses.includes(response.status)) {
    const message = await jiraErrorMessage(response);
    throw new Error(`Jira API error (${response.status}): ${message}`);
  }
  if (response.status === 204) {
    return null;
  }

  return parseJiraJSON(response, responseName);
}

function textDocument(text: string): Record<string, unknown> {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

function jiraBodyText(settings: JiraSettings, text: string): string | Record<string, unknown> {
  return jiraAPIKind(settings) === "data-center" ? text : textDocument(text);
}

function parseCreatedTicket(body: unknown, settings: JiraSettings): CreatedJiraTicket {
  if (!isRecord(body) || !isTextValue(body.id) || !isTextValue(body.key)) {
    throw new Error("Jira create issue response must include valid issue ID and key.");
  }

  const key = validateIssueKeyResponse(body.key);
  return {
    id: body.id,
    key,
    url: `${settings.baseURL}/browse/${key}`,
  };
}

function parseCommentResult(body: unknown, issueKey: string): JiraCommentResult {
  if (!isRecord(body) || !isTextValue(body.id)) {
    throw new Error("Jira comment response must include a valid comment ID.");
  }

  return {
    id: body.id,
    issueKey,
  };
}

function parseTransitionOptions(body: unknown): JiraTransitionOption[] {
  if (!isRecord(body) || !Array.isArray(body.transitions)) {
    throw new Error("Jira transitions response must include a transitions array.");
  }

  return body.transitions.map((transition) => {
    if (!isRecord(transition) || !isTextValue(transition.id)) {
      throw new Error("Jira transitions response transitions must include valid IDs and target statuses.");
    }

    const to = recordField(transition, "to");
    if (!to || !isTextValue(to.name)) {
      throw new Error("Jira transitions response transitions must include valid IDs and target statuses.");
    }

    return {
      id: transition.id,
      targetStatus: to.name,
    };
  });
}

export async function createTicket(options: CreateJiraTicketOptions): Promise<CreatedJiraTicket> {
  const settings = requireSettings();
  const projectKey = validateProjectKey(options.projectKey);
  const issueType = validateConfiguredText(options.issueType, "Jira issue type");
  const summary = validateConfiguredText(options.summary, "Jira issue summary");
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    issuetype: { name: issueType },
    summary,
  };

  if (options.description !== undefined && options.description !== null) {
    fields.description = jiraBodyText(
      settings,
      validateConfiguredText(options.description, "Jira issue description"),
    );
  }

  const body = await requestJira(
    settings,
    "Jira create issue response",
    "POST",
    jiraIssueBasePath(settings),
    { fields },
    [201],
  );

  return parseCreatedTicket(body, settings);
}

export async function addComment(issueKey: string, comment: string): Promise<JiraCommentResult> {
  const settings = requireSettings();
  const key = validateIssueKeyArgument(issueKey);
  const body = await requestJira(
    settings,
    "Jira comment response",
    "POST",
    jiraIssuePath(settings, key, "/comment"),
    { body: jiraBodyText(settings, validateConfiguredText(comment, "Jira comment")) },
    [201],
  );

  return parseCommentResult(body, key);
}

export async function assignTicketToSprint(issueKey: string, sprintID: string): Promise<void> {
  const settings = requireSettings();
  const key = validateIssueKeyArgument(issueKey);
  const sprint = validateSprintID(sprintID);

  await requestJira(
    settings,
    "Jira sprint assignment response",
    "POST",
    jiraSprintIssuePath(sprint),
    { issues: [key] },
    [204],
  );
}

export async function changeTicketStatus(
  issueKey: string,
  targetStatus: string,
): Promise<JiraStatusChangeResult> {
  const settings = requireSettings();
  const key = validateIssueKeyArgument(issueKey);
  const status = validateConfiguredText(targetStatus, "Jira target status");
  const transitionsBody = await requestJira(
    settings,
    "Jira transitions response",
    "GET",
    jiraIssuePath(settings, key, "/transitions"),
    undefined,
    [200],
  );
  const transitions = parseTransitionOptions(transitionsBody);
  const matches = transitions.filter(
    (transition) => transition.targetStatus.toLowerCase() === status.toLowerCase(),
  );

  if (matches.length === 0) {
    const availableStatuses = [...new Set(transitions.map((transition) => transition.targetStatus))];
    throw new Error(
      `No Jira transition to status ${status} is available for ${key}. Available statuses: ${availableStatuses.join(", ") || "none"}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(`Multiple Jira transitions to status ${status} are available for ${key}.`);
  }

  const match = matches[0] as JiraTransitionOption;
  await requestJira(
    settings,
    "Jira transition response",
    "POST",
    jiraIssuePath(settings, key, "/transitions"),
    { transition: { id: match.id } },
    [204],
  );

  return {
    issueKey: key,
    status: match.targetStatus,
  };
}

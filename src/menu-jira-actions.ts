import * as jiraActions from "./clients/jira-actions.ts";
import { prompt } from "./menu-prompts.ts";

export async function createJiraTicket(): Promise<void> {
  const projectKey = await prompt("Project key (blank to cancel): ");
  if (!projectKey) {
    return;
  }
  const summary = await prompt("Summary (blank to cancel): ");
  if (!summary) {
    return;
  }
  const issueTypeInput = await prompt("Issue type [Task]: ");
  const description = await prompt("Description (optional): ");
  const ticket = await jiraActions.createTicket({
    projectKey,
    issueType: issueTypeInput || "Task",
    summary,
    description: description || undefined,
  });

  console.log(`Jira ticket ${ticket.key} created: ${ticket.url}`);
}

export async function commentOnJiraTicket(): Promise<void> {
  const issueKey = await prompt("Issue key (blank to cancel): ");
  if (!issueKey) {
    return;
  }
  const comment = await prompt("Comment (blank to cancel): ");
  if (!comment) {
    return;
  }

  const result = await jiraActions.addComment(issueKey, comment);
  console.log(`Jira comment ${result.id} added to ${result.issueKey}.`);
}

export async function assignJiraTicketToSprint(): Promise<void> {
  const issueKey = await prompt("Issue key (blank to cancel): ");
  if (!issueKey) {
    return;
  }
  const sprintID = await prompt("Sprint ID (blank to cancel): ");
  if (!sprintID) {
    return;
  }

  await jiraActions.assignTicketToSprint(issueKey, sprintID);
  console.log(`Jira ticket ${issueKey.toUpperCase()} assigned to sprint ${sprintID}.`);
}

export async function changeJiraTicketStatus(): Promise<void> {
  const issueKey = await prompt("Issue key (blank to cancel): ");
  if (!issueKey) {
    return;
  }
  const status = await prompt("Target status (blank to cancel): ");
  if (!status) {
    return;
  }

  const result = await jiraActions.changeTicketStatus(issueKey, status);
  console.log(`Jira ticket ${result.issueKey} changed to ${result.status}.`);
}

import assert from "node:assert/strict";
import readline from "node:readline";
import { afterEach, describe, test } from "node:test";

import { withMockFetch } from "./clients/fetch-mock-test-support.ts";
import { saveCredentials } from "./clients/jira.ts";
import * as support from "./clients/jira-test-support.ts";
import { buildMenuTree } from "./menu.ts";

const BASE_URL = "https://stored.atlassian.net";
const JIRA_TOKEN = "stored-token";

function jiraMenuAction(label: string): () => Promise<void> | void {
  const jiraMenu = buildMenuTree().items.find((item) => item.label === "Jira")?.submenu;
  assert.ok(jiraMenu);
  const action = jiraMenu.items.find((item) => item.label === label)?.action;
  assert.ok(action);
  return action;
}

function mockPromptAnswers(answers: readonly string[]): string[] {
  const remaining = [...answers];
  const prompts: string[] = [];

  readline.createInterface = ((() => ({
    question: (prompt: string, callback: (value: string) => void) => {
      prompts.push(prompt);
      callback(remaining.shift() ?? "");
    },
    close: () => undefined,
    once: () => undefined,
  })) as unknown) as typeof readline.createInterface;

  return prompts;
}

async function captureStdout(action: () => Promise<void> | void): Promise<string> {
  const originalStdoutWrite = process.stdout.write;
  let output = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    await action();
    return output;
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
}

async function runJiraMenuAction(
  label: string,
  answers: readonly string[],
): Promise<{ output: string; prompts: string[] }> {
  const prompts = mockPromptAnswers(answers);
  const output = await captureStdout(async () => {
    await jiraMenuAction(label)();
  });

  return { output, prompts };
}

function urlText(input: URL | Request | string): string {
  return typeof input === "string" ? input : input.toString();
}

function requestBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("request body must be a string.");
  }

  return JSON.parse(body);
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

describe("menu Jira write actions", { concurrency: false }, () => {
  support.setupJiraClientTest();

  const originalCreateInterface = readline.createInterface;

  afterEach(() => {
    readline.createInterface = originalCreateInterface;
    process.stdin.removeAllListeners("data");
    process.stdin.pause();
  });

  test("menu-wired create ticket prompts and creates a Jira ticket", async () => {
    saveCredentials(BASE_URL, "stored@example.com", JIRA_TOKEN);

    await withMockFetch(
      (input, init) => {
        assert.equal(urlText(input), support.issueURL(BASE_URL));
        assert.equal(init?.method, "POST");
        assert.deepEqual(requestBody(init), {
          fields: {
            project: { key: "TC" },
            issuetype: { name: "Bug" },
            summary: "Fix checkout retry",
            description: textDocument("Retry should preserve cart state."),
          },
        });

        return support.createResponse({ id: "10001", key: "TC-123" }, 201);
      },
      async () => {
        const { output, prompts } = await runJiraMenuAction("Create ticket", [
          "tc",
          "Fix checkout retry",
          "Bug",
          "Retry should preserve cart state.",
        ]);

        assert.deepEqual(prompts, [
          "Project key (blank to cancel): ",
          "Summary (blank to cancel): ",
          "Issue type [Task]: ",
          "Description (optional): ",
        ]);
        assert.match(output, /Jira ticket TC-123 created: https:\/\/stored\.atlassian\.net\/browse\/TC-123/);
        assert.equal(output.includes(JIRA_TOKEN), false);
      },
    );
  });

  test("menu-wired comment action prompts and adds a Jira comment", async () => {
    saveCredentials(BASE_URL, "stored@example.com", JIRA_TOKEN);

    await withMockFetch(
      (input, init) => {
        assert.equal(urlText(input), support.issueCommentURL(BASE_URL, "TC-123"));
        assert.equal(init?.method, "POST");
        assert.deepEqual(requestBody(init), { body: textDocument("Looks good.") });

        return support.createResponse({ id: "10002" }, 201);
      },
      async () => {
        const { output, prompts } = await runJiraMenuAction("Comment on ticket", [
          "tc-123",
          "Looks good.",
        ]);

        assert.deepEqual(prompts, [
          "Issue key (blank to cancel): ",
          "Comment (blank to cancel): ",
        ]);
        assert.match(output, /Jira comment 10002 added to TC-123/);
        assert.equal(output.includes(JIRA_TOKEN), false);
      },
    );
  });

  test("menu-wired sprint action prompts and assigns a Jira ticket to a sprint", async () => {
    saveCredentials(BASE_URL, "stored@example.com", JIRA_TOKEN);

    await withMockFetch(
      (input, init) => {
        assert.equal(urlText(input), support.sprintIssueURL(BASE_URL, "42"));
        assert.equal(init?.method, "POST");
        assert.deepEqual(requestBody(init), { issues: ["TC-123"] });

        return new Response(null, { status: 204 });
      },
      async () => {
        const { output, prompts } = await runJiraMenuAction("Assign ticket to sprint", [
          "tc-123",
          "42",
        ]);

        assert.deepEqual(prompts, [
          "Issue key (blank to cancel): ",
          "Sprint ID (blank to cancel): ",
        ]);
        assert.match(output, /Jira ticket TC-123 assigned to sprint 42/);
        assert.equal(output.includes(JIRA_TOKEN), false);
      },
    );
  });

  test("menu-wired status action prompts and changes a Jira ticket status", async () => {
    saveCredentials(BASE_URL, "stored@example.com", JIRA_TOKEN);
    const calls: string[] = [];

    await withMockFetch(
      (input, init) => {
        const url = urlText(input);
        assert.equal(url, support.issueTransitionsURL(BASE_URL, "TC-123"));
        calls.push(`${init?.method ?? "GET"} ${url}`);

        if (init?.method === "POST") {
          assert.deepEqual(requestBody(init), { transition: { id: "31" } });
          return new Response(null, { status: 204 });
        }

        return support.createResponse({
          transitions: [
            { id: "11", name: "Start Progress", to: { name: "In Progress" } },
            { id: "31", name: "Resolve", to: { name: "Done" } },
          ],
        });
      },
      async () => {
        const { output, prompts } = await runJiraMenuAction("Change ticket status", [
          "tc-123",
          "done",
        ]);

        assert.deepEqual(prompts, [
          "Issue key (blank to cancel): ",
          "Target status (blank to cancel): ",
        ]);
        assert.deepEqual(calls, [
          `GET ${support.issueTransitionsURL(BASE_URL, "TC-123")}`,
          `POST ${support.issueTransitionsURL(BASE_URL, "TC-123")}`,
        ]);
        assert.match(output, /Jira ticket TC-123 changed to Done/);
        assert.equal(output.includes(JIRA_TOKEN), false);
      },
    );
  });

  test("menu-wired Jira write actions cancel on blank required prompts", async () => {
    saveCredentials(BASE_URL, "stored@example.com", JIRA_TOKEN);

    const scenarios: Array<{
      label: string;
      answers: string[];
      prompts: string[];
    }> = [
      {
        label: "Create ticket",
        answers: [""],
        prompts: ["Project key (blank to cancel): "],
      },
      {
        label: "Create ticket",
        answers: ["TC", ""],
        prompts: ["Project key (blank to cancel): ", "Summary (blank to cancel): "],
      },
      {
        label: "Comment on ticket",
        answers: [""],
        prompts: ["Issue key (blank to cancel): "],
      },
      {
        label: "Comment on ticket",
        answers: ["TC-123", ""],
        prompts: ["Issue key (blank to cancel): ", "Comment (blank to cancel): "],
      },
      {
        label: "Assign ticket to sprint",
        answers: [""],
        prompts: ["Issue key (blank to cancel): "],
      },
      {
        label: "Assign ticket to sprint",
        answers: ["TC-123", ""],
        prompts: ["Issue key (blank to cancel): ", "Sprint ID (blank to cancel): "],
      },
      {
        label: "Change ticket status",
        answers: [""],
        prompts: ["Issue key (blank to cancel): "],
      },
      {
        label: "Change ticket status",
        answers: ["TC-123", ""],
        prompts: ["Issue key (blank to cancel): ", "Target status (blank to cancel): "],
      },
    ];

    for (const scenario of scenarios) {
      let fetchCalls = 0;
      await withMockFetch(
        () => {
          fetchCalls += 1;
          return support.createResponse({});
        },
        async () => {
          const { output, prompts } = await runJiraMenuAction(scenario.label, scenario.answers);

          assert.deepEqual(prompts, scenario.prompts, scenario.label);
          assert.equal(fetchCalls, 0, scenario.label);
          assert.equal(output, "", scenario.label);
        },
      );
    }
  });
});

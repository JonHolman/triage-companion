import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createVisibleProviderTokens } from "./provider-tokens.ts";

type BrowserStep = Record<string, string | number>;
type AtlassianStepUpPending = {
  csrfToken: string;
  transactionToken: string;
  continueURL: string;
  requestedAt: string;
};

const jiraEmail = "triage-companion-demo@jonholman.com";
const atlassianStepUpURL =
  "https://id.atlassian.com/step-up/start?continue=https%3A%2F%2Fid.atlassian.com%2Fmanage-profile%2Fsecurity%2Fapi-tokens";
const jiraRuntimeScopes = ["read:me", "read:jira-user", "read:jira-work"];
const jiraSetupScopes = [
  "read:me",
  "read:jira-user",
  "read:jira-work",
  "write:jira-work",
  "manage:jira-configuration",
];

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function dataRoot(): string {
  return path.join(os.homedir(), "data", "triage-companion-demo");
}

function jonBrowserRoot(): string {
  return process.env.JONBROWSER_REPO ?? path.join(os.homedir(), "repos", "personal", "jonBrowser");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function writeJSONScript(scriptPath: string, steps: readonly BrowserStep[]): void {
  fs.writeFileSync(scriptPath, `${JSON.stringify({ steps }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(scriptPath, 0o600);
}

function runBrowserScript(jonBrowserDir: string, scriptPath: string): void {
  const result = spawnSync("swift", ["run", "BrowserCLI", "script", scriptPath], {
    cwd: jonBrowserDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`BrowserCLI failed for ${path.basename(scriptPath)}`);
  }
}

function readSecret(secretPath: string, name: string): string {
  const value = fs.readFileSync(secretPath, "utf-8").trim();
  if (!value || /[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error(`${name} was not captured as a single non-empty line.`);
  }

  return value;
}

function writeEnvFile(envPath: string, values: Record<string, string>): void {
  fs.mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(envPath), 0o700);
  const content = Object.entries(values)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n") + "\n";
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

function stepUpPendingPath(): string {
  return path.join(dataRoot(), "token-creation", "step-up-pending.json");
}

function readStepUpPending(pendingPath: string): AtlassianStepUpPending {
  const pending = JSON.parse(fs.readFileSync(pendingPath, "utf-8")) as Partial<AtlassianStepUpPending>;
  if (
    typeof pending.csrfToken !== "string" ||
    pending.csrfToken.length === 0 ||
    typeof pending.transactionToken !== "string" ||
    pending.transactionToken.length === 0 ||
    typeof pending.continueURL !== "string" ||
    pending.continueURL.length === 0 ||
    typeof pending.requestedAt !== "string" ||
    pending.requestedAt.length === 0
  ) {
    throw new Error("Atlassian step-up transaction is missing or incomplete. Run without a code to request a new passcode.");
  }

  return {
    csrfToken: pending.csrfToken,
    transactionToken: pending.transactionToken,
    continueURL: pending.continueURL,
    requestedAt: pending.requestedAt,
  };
}

function atlassianRequestStepUpScript(pendingPath: string): BrowserStep[] {
  return [
    { command: "open", url: atlassianStepUpURL },
    { command: "wait", seconds: 5 },
    {
      command: "save-eval",
      path: pendingPath,
      javascript: `
        (async () => {
          const params = new URLSearchParams(location.search);
          const stateResponse = await fetch('/rest/step-up/start/state' + location.search, {
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
          });
          if (!stateResponse.ok) {
            throw new Error(\`Atlassian step-up state failed with HTTP \${stateResponse.status}\`);
          }
          const state = await stateResponse.json();
          const csrfToken = typeof state.csrfToken === 'string' ? state.csrfToken : '';
          const token = state.stepUp && typeof state.stepUp.token === 'string' ? state.stepUp.token : '';
          if (!csrfToken || !token) {
            throw new Error('Atlassian step-up state did not include the required token data');
          }
          const response = await fetch('/rest/step-up/start', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'X-CSRF-TOKEN': csrfToken
            },
            body: JSON.stringify({
              continue: params.get('continue'),
              application: params.get('application'),
              token
            })
          });
          if (!response.ok) {
            throw new Error(\`Atlassian step-up passcode request failed with HTTP \${response.status}\`);
          }
          const data = await response.json();
          const transactionToken = typeof data.transactionToken === 'string' ? data.transactionToken : '';
          if (!transactionToken) {
            throw new Error('Atlassian step-up passcode request did not return a transaction token');
          }
          sessionStorage.setItem('mfaToken', transactionToken);
          history.replaceState(null, '', location.pathname + location.search + '#sent');
          return JSON.stringify({
            csrfToken,
            transactionToken,
            continueURL: params.get('continue') || '',
            requestedAt: new Date().toISOString()
          });
        })()
      `,
    },
  ];
}

function atlassianVerifyAndCreateScript(
  code: string,
  pending: AtlassianStepUpPending,
  runtimeTokenPath: string,
  setupTokenPath: string,
  sitePath: string,
  verifiedPath: string,
  runLabel: string,
): BrowserStep[] {
  return [
    { command: "open", url: atlassianStepUpURL },
    { command: "wait", seconds: 2 },
    {
      command: "save-eval",
      path: verifiedPath,
      javascript: `
        (async () => {
          const pendingTransactionToken = ${JSON.stringify(pending.transactionToken)};
          const verifyResponse = await fetch(
            '/rest/mfa/verify?transactionToken=' + encodeURIComponent(pendingTransactionToken),
            {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': ${JSON.stringify(pending.csrfToken)}
              },
              body: JSON.stringify({ otpCode: ${JSON.stringify(code)} })
            }
          );
          if (!verifyResponse.ok) {
            throw new Error(\`Atlassian step-up verification failed with HTTP \${verifyResponse.status}\`);
          }
          const verifyData = await verifyResponse.json();
          const authorizeToken = typeof verifyData.transactionToken === 'string' ? verifyData.transactionToken : '';
          if (!authorizeToken) {
            throw new Error('Atlassian step-up verification did not return an authorization token');
          }
          const authorizeResponse = await fetch('/rest/mfa/authorize?transactionToken=' + encodeURIComponent(authorizeToken), {
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
          });
          if (!authorizeResponse.ok) {
            throw new Error(\`Atlassian step-up authorization failed with HTTP \${authorizeResponse.status}\`);
          }
          const authorizeData = await authorizeResponse.json();
          const redirectUri = typeof authorizeData.redirectUri === 'string' ? authorizeData.redirectUri : '';
          if (!redirectUri) {
            throw new Error('Atlassian step-up authorization did not return a redirect URL');
          }
          const redirect = new URL(redirectUri);
          redirect.searchParams.append('continue', ${JSON.stringify(pending.continueURL)});
          location.href = redirect.toString();
          return 'verified';
        })()
      `,
    },
    { command: "wait-for-url", url: "/manage-profile/security/api-tokens" },
    { command: "wait", seconds: 5 },
    {
      command: "save-eval",
      path: sitePath,
      javascript: `
        (async () => {
          const response = await fetch('/gateway/api/available-sites', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              products: [
                'confluence.ondemand',
                'jira-core.ondemand',
                'jira-servicedesk.ondemand',
                'jira-software.ondemand'
              ]
            })
          });
          if (!response.ok) {
            throw new Error(\`Atlassian site discovery failed with HTTP \${response.status}\`);
          }
          const data = await response.json();
          const sites = Array.isArray(data.sites) ? data.sites : [];
          const site = sites.find((candidate) => {
            return typeof candidate.url === 'string' &&
              candidate.url.includes('.atlassian.net') &&
              typeof candidate.cloudId === 'string';
          });
          if (!site) {
            throw new Error('Atlassian site discovery did not return a Jira site');
          }
          return JSON.stringify({
            baseURL: site.url.replace(/\\/+$/, ''),
            cloudID: site.cloudId
          });
        })()
      `,
    },
    {
      command: "save-eval",
      path: runtimeTokenPath,
      javascript: atlassianCreateTokenExpression(`triage-companion jira runtime ${runLabel}`, jiraRuntimeScopes),
    },
    {
      command: "save-eval",
      path: setupTokenPath,
      javascript: atlassianCreateTokenExpression(`triage-companion jira setup ${runLabel}`, jiraSetupScopes),
    },
  ];
}

function atlassianCreateTokenExpression(label: string, scopes: readonly string[]): string {
  return `
    (async () => {
      const meResponse = await fetch('/gateway/api/me', {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!meResponse.ok) {
        throw new Error(\`Atlassian profile lookup failed with HTTP \${meResponse.status}\`);
      }
      const me = await meResponse.json();
      const accountId = me.account_id || me.accountId || me.id;
      if (!accountId) {
        throw new Error('Atlassian profile response did not include an account ID');
      }
      const expiry = new Date(Date.now() + 7 * 86400000).toISOString();
      const response = await fetch(\`/gateway/api/users/\${accountId}/manage/api-tokens\`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: ${JSON.stringify(label)},
          expiry,
          products: ['jira'],
          scopes: ${JSON.stringify(scopes)}
        })
      });
      if (!response.ok) {
        throw new Error(\`Atlassian token creation failed with HTTP \${response.status}\`);
      }
      const data = await response.json();
      if (!data || typeof data.token !== 'string' || data.token.length === 0) {
        throw new Error('Atlassian token creation did not return a token');
      }
      return data.token;
    })()
  `;
}

function readSiteMetadata(sitePath: string): { baseURL: string; cloudID: string } {
  const site = JSON.parse(fs.readFileSync(sitePath, "utf-8")) as {
    baseURL?: unknown;
    cloudID?: unknown;
  };
  if (typeof site.baseURL !== "string" || typeof site.cloudID !== "string") {
    throw new Error("Atlassian site metadata was not captured.");
  }

  return { baseURL: site.baseURL, cloudID: site.cloudID };
}

async function main(): Promise<void> {
  const runLabel = timestamp();
  const runDir = path.join(dataRoot(), "token-creation", "runs", runLabel);
  const secretDir = path.join(runDir, "secrets");
  const jonBrowserDir = jonBrowserRoot();
  const envPath = path.join(dataRoot(), "demo.env");
  const pendingPath = stepUpPendingPath();
  const stepUpCode = process.env.TRIAGE_COMPANION_DEMO_ATLASSIAN_STEP_UP_CODE ?? "";

  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(runDir, 0o700);
  fs.chmodSync(secretDir, 0o700);

  console.log(`Token setup demo run: ${runDir}`);

  if (stepUpCode === "") {
    const requestScriptPath = path.join(runDir, "atlassian-request-step-up.json");
    fs.rmSync(pendingPath, { force: true });
    writeJSONScript(requestScriptPath, atlassianRequestStepUpScript(pendingPath));
    runBrowserScript(jonBrowserDir, requestScriptPath);
    throw new Error(
      "Atlassian sent an 8-digit verification code. Re-run with TRIAGE_COMPANION_DEMO_ATLASSIAN_STEP_UP_CODE set to that code.",
    );
  }
  if (!/^\d{8}$/.test(stepUpCode)) {
    throw new Error("TRIAGE_COMPANION_DEMO_ATLASSIAN_STEP_UP_CODE must be the 8-digit Atlassian verification code.");
  }

  const jiraRuntimeTokenPath = path.join(secretDir, "jira-runtime-token.txt");
  const jiraSetupTokenPath = path.join(secretDir, "jira-setup-token.txt");
  const jiraSitePath = path.join(runDir, "jira-site.json");
  const atlassianStepUpVerifiedPath = path.join(runDir, "atlassian-step-up-verified.txt");
  const atlassianScriptPath = path.join(runDir, "atlassian-create-tokens.json");
  const pending = readStepUpPending(pendingPath);
  writeJSONScript(
    atlassianScriptPath,
    atlassianVerifyAndCreateScript(
      stepUpCode,
      pending,
      path.relative(runDir, jiraRuntimeTokenPath),
      path.relative(runDir, jiraSetupTokenPath),
      path.relative(runDir, jiraSitePath),
      path.relative(runDir, atlassianStepUpVerifiedPath),
      runLabel,
    ),
  );
  try {
    runBrowserScript(jonBrowserDir, atlassianScriptPath);
  } finally {
    fs.rmSync(atlassianScriptPath, { force: true });
  }

  const providerTokens = await createVisibleProviderTokens({ runDir, secretDir, runLabel });

  const jiraSite = readSiteMetadata(jiraSitePath);
  writeEnvFile(envPath, {
    TRIAGE_COMPANION_DEMO_GITHUB_SETUP_TOKEN: readSecret(providerTokens.githubSetupTokenPath, "GitHub setup token"),
    TRIAGE_COMPANION_DEMO_GITHUB_RUNTIME_TOKEN: readSecret(providerTokens.githubRuntimeTokenPath, "GitHub runtime token"),
    TRIAGE_COMPANION_DEMO_SNYK_TOKEN: readSecret(providerTokens.snykTokenPath, "Snyk token"),
    TRIAGE_COMPANION_DEMO_JIRA_BASE_URL: jiraSite.baseURL,
    TRIAGE_COMPANION_DEMO_JIRA_EMAIL: jiraEmail,
    TRIAGE_COMPANION_DEMO_JIRA_API_TOKEN: readSecret(jiraRuntimeTokenPath, "Jira runtime token"),
    TRIAGE_COMPANION_DEMO_JIRA_CLOUD_ID: jiraSite.cloudID,
    TRIAGE_COMPANION_DEMO_JIRA_SETUP_API_TOKEN: readSecret(jiraSetupTokenPath, "Jira setup token"),
  });

  fs.rmSync(secretDir, { recursive: true, force: true });
  fs.rmSync(pendingPath, { force: true });
  console.log(`Wrote ${envPath}`);
}

await main();

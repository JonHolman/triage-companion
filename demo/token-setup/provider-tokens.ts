import fs from "node:fs";
import net from "node:net";
import path from "node:path";

interface BrowserRemoteRequest {
  id: string;
  method: string;
  url?: string;
  text?: string;
  script?: string;
  path?: string;
  seconds?: number;
}

interface BrowserRemoteResponse {
  id: string;
  ok: boolean;
  message?: string;
  value?: unknown;
  error?: string;
}

interface ProviderTokenOptions {
  runDir: string;
  secretDir: string;
  runLabel: string;
}

export interface ProviderTokenPaths {
  githubRuntimeTokenPath: string;
  githubSetupTokenPath: string;
  snykTokenPath: string;
}

let nextRemoteID = 1;

function visiblePort(): number {
  const rawPort = process.env.JONBROWSER_VISIBLE_PORT ?? "17365";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== rawPort) {
    throw new Error(`Invalid JONBROWSER_VISIBLE_PORT: ${rawPort}`);
  }

  return port;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRemoteResponse(line: string): BrowserRemoteResponse {
  const parsed = JSON.parse(line) as unknown;
  if (!isObject(parsed) || typeof parsed.id !== "string" || typeof parsed.ok !== "boolean") {
    throw new Error("jonBrowser returned an invalid remote-control response.");
  }

  return {
    id: parsed.id,
    ok: parsed.ok,
    message: typeof parsed.message === "string" ? parsed.message : undefined,
    value: parsed.value,
    error: typeof parsed.error === "string" ? parsed.error : undefined,
  };
}

async function remoteCommand(
  method: string,
  fields: Omit<BrowserRemoteRequest, "id" | "method"> = {},
  timeoutMS = 120000,
): Promise<BrowserRemoteResponse> {
  const id = String(nextRemoteID++);
  const request: BrowserRemoteRequest = { id, method, ...fields };

  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: visiblePort() });
    let settled = false;
    let buffer = "";
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`jonBrowser ${method} timed out after ${timeoutMS}ms.`));
      }
    }, timeoutMS);

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1 || settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.end();
      try {
        const response = parseRemoteResponse(buffer.slice(0, newline));
        if (!response.ok) {
          reject(new Error(response.error ?? `jonBrowser ${method} failed.`));
          return;
        }
        resolve(response);
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    socket.on("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`jonBrowser closed the connection before ${method} returned.`));
      }
    });
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function asyncResultKey(label: string): string {
  return `__triageCompanionDemo_${label.replace(/[^A-Za-z0-9_]/g, "_")}_${Date.now()}_${nextRemoteID}`;
}

async function visibleEvalAsync(script: string, label: string, timeoutMS = 120000): Promise<unknown> {
  const key = asyncResultKey(label);
  await remoteCommand("evaluate", {
    script: `
      (() => {
        const key = ${JSON.stringify(key)};
        window[key] = { state: 'pending' };
        Promise.resolve()
          .then(async () => await (${script}))
          .then((value) => { window[key] = { state: 'done', value }; })
          .catch((error) => {
            window[key] = {
              state: 'error',
              error: String((error && error.stack) || error)
            };
          });
        return key;
      })()
    `,
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMS) {
    await sleep(1000);
    const response = await remoteCommand("evaluate", {
      script: `(() => window[${JSON.stringify(key)}] || { state: 'missing' })()`,
    });
    const result = response.value;
    if (!isObject(result) || typeof result.state !== "string") {
      throw new Error(`${label} returned an invalid async status.`);
    }
    if (result.state === "done") {
      await remoteCommand("evaluate", { script: `(() => { delete window[${JSON.stringify(key)}]; return true; })()` });
      return result.value;
    }
    if (result.state === "error") {
      await remoteCommand("evaluate", { script: `(() => { delete window[${JSON.stringify(key)}]; return true; })()` });
      throw new Error(typeof result.error === "string" ? result.error : `${label} failed.`);
    }
  }

  throw new Error(`${label} timed out after ${timeoutMS}ms.`);
}

function writeSecret(secretPath: string, value: unknown, name: string): void {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error(`${name} was not captured as a single non-empty line.`);
  }

  fs.mkdirSync(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(secretPath, value, { mode: 0o600 });
  fs.chmodSync(secretPath, 0o600);
}

function githubPrepareTokenFormExpression(note: string, scopes: readonly string[]): string {
  return `
    (() => {
      const noteInput = document.querySelector('#oauth_access_description');
      if (!noteInput) {
        throw new Error('missing GitHub token note field');
      }
      noteInput.value = ${JSON.stringify(note)};
      noteInput.dispatchEvent(new Event('input', { bubbles: true }));
      noteInput.dispatchEvent(new Event('change', { bubbles: true }));

      const expiryInput = document.querySelector('input[name="oauth_access[default_expires_at]"]');
      if (!expiryInput) {
        throw new Error('missing GitHub token expiration field');
      }
      expiryInput.value = '7';
      expiryInput.dispatchEvent(new Event('input', { bubbles: true }));
      expiryInput.dispatchEvent(new Event('change', { bubbles: true }));

      for (const scope of ${JSON.stringify(scopes)}) {
        const input = document.querySelector('input[value="' + scope + '"]');
        if (!input) {
          throw new Error('missing GitHub scope ' + scope);
        }
        if (!input.checked) {
          input.click();
        }
      }
      return 'prepared';
    })()
  `;
}

function githubCreateTokenExpression(note: string, scopes: readonly string[]): string {
  return `
    (async () => {
      const noteInput = document.querySelector('#oauth_access_description');
      const form = noteInput && noteInput.closest('form');
      if (!form) {
        throw new Error('missing GitHub token form');
      }
      const data = new FormData(form);
      data.set('oauth_access[description]', ${JSON.stringify(note)});
      data.set('oauth_access[default_expires_at]', '7');
      data.set('oauth_access[custom_expires_at]', '');
      data.delete('oauth_access[scopes][]');
      for (const scope of ${JSON.stringify(scopes)}) {
        data.append('oauth_access[scopes][]', scope);
      }

      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
        body: data,
        redirect: 'follow'
      });
      if (!response.ok) {
        throw new Error(\`GitHub token creation failed with HTTP \${response.status}\`);
      }
      const html = await response.text();
      const match = html.match(/\\b(?:ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\\b/);
      if (!match) {
        throw new Error('GitHub token creation did not return a visible token');
      }
      return match[0];
    })()
  `;
}

async function createGitHubToken(
  note: string,
  scopes: readonly string[],
  pdfPath: string,
  tokenPath: string,
): Promise<void> {
  await remoteCommand("open", { url: "https://github.com/settings/tokens/new", seconds: 60 });
  await remoteCommand("waitForText", { text: "New personal access token (classic)", seconds: 30 }, 60000);
  await remoteCommand("evaluate", { script: githubPrepareTokenFormExpression(note, scopes) });
  await remoteCommand("pdf", { path: pdfPath }, 120000);
  const token = await visibleEvalAsync(githubCreateTokenExpression(note, scopes), "GitHub token creation");
  writeSecret(tokenPath, token, "GitHub token");
}

function snykCreateTokenExpression(label: string): string {
  return `
    (async () => {
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      const response = await fetch('/api/hidden/self/personal_access_tokens?version=2024-03-19', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json'
        },
        body: JSON.stringify({
          data: {
            type: 'personal_access_token',
            attributes: {
              label: ${JSON.stringify(label)},
              expires_at: expiresAt
            }
          }
        })
      });
      if (!response.ok) {
        throw new Error(\`Snyk token creation failed with HTTP \${response.status}\`);
      }
      const data = await response.json();
      const token = data && data.data && data.data.attributes && data.data.attributes.token;
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('Snyk token creation did not return a token');
      }
      return token;
    })()
  `;
}

async function createSnykToken(label: string, pdfPath: string, tokenPath: string): Promise<void> {
  await remoteCommand("open", { url: "https://app.snyk.io/account/personal-access-tokens", seconds: 60 });
  await remoteCommand("waitForText", { text: "Personal Access Tokens", seconds: 30 }, 60000);
  await remoteCommand("pdf", { path: pdfPath }, 120000);
  const token = await visibleEvalAsync(snykCreateTokenExpression(label), "Snyk token creation");
  writeSecret(tokenPath, token, "Snyk token");
}

export async function createVisibleProviderTokens(options: ProviderTokenOptions): Promise<ProviderTokenPaths> {
  const githubRuntimeTokenPath = path.join(options.secretDir, "github-runtime-token.txt");
  const githubSetupTokenPath = path.join(options.secretDir, "github-setup-token.txt");
  const snykTokenPath = path.join(options.secretDir, "snyk-token.txt");

  await createGitHubToken(
    `triage-companion runtime demo ${options.runLabel}`,
    ["notifications", "security_events"],
    path.join(options.runDir, "github-runtime-token-ready.pdf"),
    githubRuntimeTokenPath,
  );
  await createGitHubToken(
    `triage-companion setup demo ${options.runLabel}`,
    ["public_repo", "security_events"],
    path.join(options.runDir, "github-setup-token-ready.pdf"),
    githubSetupTokenPath,
  );
  await createSnykToken(
    `triage-companion demo ${options.runLabel}`,
    path.join(options.runDir, "snyk-account-token-page.pdf"),
    snykTokenPath,
  );

  return { githubRuntimeTokenPath, githubSetupTokenPath, snykTokenPath };
}

# Triage Companion CLI

Triage Companion is a terminal tool for checking GitHub notifications, GitHub Dependabot alerts, Snyk issues, Jira tickets, and local Git repository state.

It runs on Node 26+ and executes TypeScript directly with no separate build step during local development.

## Quick start

1. Install dependencies.

```sh
npm install
```

2. Open the interactive menu.

```sh
npm start
```

3. Save credentials from the menu or with direct commands.

```sh
npm start -- github token <token>
npm start -- snyk token <token>
npm start -- snyk api-base-url https://api.us.snyk.io/rest
npm start -- jira credentials https://your-company.atlassian.net user@your-company.com <token>
```

4. Check status.

```sh
npm start -- status
```

## Running the CLI

Use the direct command for everyday work:

```sh
triage-companion status
triage-companion config show
triage-companion github notifications
triage-companion github failed-workflows
triage-companion snyk issues
triage-companion jira tickets
triage-companion git dirty
```

Running `triage-companion` with no arguments opens the interactive terminal menu.
Run `triage-companion --help` to display the standard CLI help.
Run `triage-companion menu` to open the same menu explicitly.
Use the arrow keys to move, `Enter` to select, and `Esc` or `q` to go back.
The menu exposes status, GitHub, Snyk, Jira, Git, and configuration actions.

The menu can:

- View status without exposing secrets.
- Set, replace, or remove GitHub, Snyk, and Jira credentials.
- Set or reset the Snyk US-hosted REST API base URL.
- View configured values without printing secret values.
- Inspect GitHub notifications, failed GitHub Actions workflows, GitHub security alerts, Snyk issues, severity-filtered Snyk issues, Jira tickets, and Git status.
- List your open GitHub PRs normally, with a GitHub login override, or with a custom author regex.
- Edit Git search roots and clear stored roots back to the defaults when no env override is set.

## Installation entrypoints

Run the repository checkout directly:

```sh
npm start -- status
```

Run the installed binary without a build step:

```sh
npm link
triage-companion status
```

## Setup

```sh
npm install
```

If you want to invoke the TypeScript entrypoint directly from npm scripts, use `npm start`.

Credentials are stored in the local user config directory shown by `triage-companion status`.
Set `TRIAGE_COMPANION_CONFIG_DIR` to use a different directory.
Home-relative paths such as `~/triage-companion` are supported.
`triage-companion config show` hides secret values, reports malformed secret settings as invalid instead of configured, and reports blank invalid non-secret settings as invalid instead of hiding them or showing them as not set.

By default credentials are persisted to:

- macOS: `~/Library/Application Support/Triage Companion/secrets.json`
- Linux: `~/.config/triage-companion/secrets.json`
- Windows: `%APPDATA%\\Triage Companion\\secrets.json`

Tokens that you enter through the CLI are persisted in `secrets.json`.

## USA-only data residency

The CLI only sends requests to the services you configure.
For Snyk, the client only accepts US-hosted REST API base URLs: `https://api.snyk.io/rest` and `https://api.us.snyk.io/rest`.
Snyk issue links are constructed locally from the organization slug, project ID, and issue key, and always point to the US Snyk app host that matches the configured API base URL: `https://app.snyk.io` or `https://app.us.snyk.io`.
Snyk Gov is US-hosted, but this token-based client does not support it because Snyk Gov requires OAuth instead of static API tokens.
Endpoint allowlists only control where this CLI sends requests.
They do not prove that a provider stores every operational, authentication, analytics, billing, support, or subprocessed data element only in the United States.
For strict USA-only handling, confirm the service contract, tenant, enterprise, or Atlassian site residency configuration before saving credentials.
Snyk documents that regional hosting applies to selected data types and that some data types are globally stored: https://docs.snyk.io/snyk-data-and-governance/regional-hosting-and-data-residency.

## Setup by service

### GitHub

Save a GitHub token with:

```sh
triage-companion github token <token>
```

Find or create the token in GitHub Settings > Developer settings > Personal access tokens.
If your organization uses SSO, authorize the token for that organization before using it here.
If USA-only residency is required, confirm that the GitHub account or enterprise configuration satisfies that requirement before saving a token.
The token is persisted locally after you save it.

Minimum permissions:

- `github notifications`: classic personal access token with the `notifications` scope; GitHub does not support fine-grained PATs for notification endpoints
- `github mark-read`: classic personal access token with the `notifications` scope; GitHub does not support fine-grained PATs for notification endpoints
- `github security-alerts`: fine-grained token with `Dependabot alerts: read`; classic token with `security_events` for public repositories or `repo` for private repositories
- `github failed-workflows`: fine-grained token with `Actions: read`; classic token with `repo` for private repositories
- `github my-open-prs`: no token is required for local git discovery, but if local git identity is unavailable a configured token lets the CLI infer your GitHub login; a token is also used to read PR or commit metadata that local git cannot provide

`github failed-workflows` checks the current GitHub clone when no repository is provided.
Pass one or more `owner/repo` values to check specific repositories.
If a local `origin` is blank, or points at `github.com` but is malformed, including surrounding whitespace or dot path segments like `./repo`, GitHub commands fail with the specific remote configuration error instead of treating that clone as non-GitHub, and malformed remotes are reported without echoing the raw remote URL back to the terminal.
When you pass explicit local paths to `github my-open-prs`, each path must exist as a directory and be a Git repository.
When you pass `--github-login`, use the exact GitHub login with no surrounding whitespace.
When you pass `--search-roots` to `github my-open-prs`, use a JSON array of paths and those roots override the default discovery roots for that invocation. Blank values are invalid; pass `[]` to disable discovery for that run.
Home-relative search roots such as `~/repos` are supported there too.
If multiple pull requests share the same commit SHA, `github my-open-prs` matches them by the pull request head branch instead of attributing every matching SHA to the same local branch.
Set `TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES` to `[]` if you do not want the default `main`, `master`, and `production` branch exclusions.
`github mark-read` expects the numeric notification thread ID exactly as shown, with no surrounding whitespace.

### Snyk

Save a Snyk token with:

```sh
triage-companion snyk token <token>
```

Get the token from your Snyk account or organization settings page.
The token is persisted locally after you save it.
For USA-only Snyk data residency, leave the default US-01 REST API base URL or set `TRIAGE_COMPANION_SNYK_API_BASE_URL` to `https://api.us.snyk.io/rest` for SNYK-US-02.
You can persist a regional value with `triage-companion snyk api-base-url <url>` or set it from the interactive menu.
If `TRIAGE_COMPANION_SNYK_API_BASE_URL` is set, that environment override still takes precedence over the saved value.
Use only the bare Snyk REST API base URL; do not include usernames, tokens, other credentials, control characters, or path dot segments like `/./` or `/../` in the URL.
Non-US Snyk REST API URLs are rejected before the client makes an API request, and issue links are constructed locally against the matching US Snyk app host instead of trusting link values from the API.
Malformed Snyk issue rows that are missing the project relationship, the issue key, timestamps, or that reference a project missing from the project list, are rejected instead of being grouped under an unknown project.

Minimum permissions:

- `snyk issues`: read access to the target organizations and projects; no write access is required

### Jira

Save Jira credentials with:

```sh
triage-companion jira credentials https://your-company.atlassian.net user@your-company.com <token>
```

Use the site root from the browser address bar as the base URL.
For example, if the browser shows `https://your-company.atlassian.net/browse/ABC-123`, the base URL is `https://your-company.atlassian.net`.
Do not include usernames, tokens, other credentials, control characters, or path dot segments like `/./` or `/../` in the Jira base URL.
If USA-only residency is required, confirm the Atlassian site data residency policy with your site admin before saving Jira credentials.
The base URL, email, and token are persisted locally after you save them.
If `JIRA_BASE_URL`, `JIRA_EMAIL`, or `JIRA_API_TOKEN` is set, those environment overrides still take precedence over the saved Jira credentials.

Minimum permissions:

- `jira tickets`: Jira permissions `Browse Projects` and `View Issues` in the projects you want to query

### Token permissions and feature requirements

If you only use a subset of commands, grant only the permissions needed for those commands.
The CLI also prints the same requirement list when saving credentials and when a command is blocked by missing configuration.

## Git search roots

Git commands search for repositories under the configured search roots.
The built-in `DEFAULT_SEARCH_ROOTS` are:

- `~/Projects`
- `~/repos`
- `~/workspace`
- `~/work`
- `~/code`
- `~/src`

Only existing directories are used.
Missing directories, empty values, and non-directory paths are ignored.
Home-relative paths such as `~/repos` are supported.
Unreadable directories under a search root make repository discovery fail instead of being skipped.
This keeps the defaults sensible across macOS, Linux, and Windows.

You can override the defaults with `TRIAGE_COMPANION_GIT_SEARCH_ROOTS`.
Set it to a JSON array of non-empty paths.
When the variable contains a non-empty array, it replaces the defaults.
Set it to `[]` if you want Git repository discovery to return no repositories from search roots.
If the variable is blank, the CLI uses stored roots or the built-in defaults.
If the variable is set to invalid JSON, it still overrides stored roots and defaults, and Git repository discovery will fail until you fix or unset it.
`triage-companion status` reports that invalid Git search-root configuration under the Git section so the broken discovery state is visible before you run a Git-based command.

Git search roots can be edited from the interactive menu or direct CLI commands:

```sh
triage-companion config git-search-roots '["~/Projects","~/repos"]'

triage-companion config reset-git-search-roots
```

Saving Git search roots updates the stored configuration.
Use `[]` to clear stored roots; blank or whitespace-padded CLI JSON is invalid.
In the interactive menu, blank or whitespace-only git search-root input cancels; use `[]` to clear stored roots there too.
Relative paths are resolved against the current working directory before they are stored, and the resolved stored paths still must be valid paths without control characters.
Home-relative paths such as `~/repos` remain home-relative.
If `TRIAGE_COMPANION_GIT_SEARCH_ROOTS` is set, that environment override still takes precedence over the saved roots.
If any saved roots do not currently exist as directories, the CLI warns that they will be ignored.
`triage-companion config reset-git-search-roots` clears stored search roots.
If `TRIAGE_COMPANION_GIT_SEARCH_ROOTS` is set, that environment override still takes precedence after the reset.
Malformed stored Git search-root config is reported as a configuration error instead of silently falling back to defaults.
GitHub remote origin URLs and GitHub API/web links with embedded control characters are rejected instead of being normalized into valid-looking URLs.

## Configuration and environment variables

Supported environment variables:

- `TRIAGE_COMPANION_CONFIG_DIR`: directory for `secrets.json`, with no surrounding whitespace or control characters; a blank value is ignored
- `TRIAGE_COMPANION_GIT`: path to the Git binary, with no surrounding whitespace; a blank value is ignored
- `TRIAGE_COMPANION_GIT_SEARCH_ROOTS`: JSON array override for Git search roots, with no surrounding whitespace around the JSON value, no surrounding whitespace in each path, and no control characters in each path
- `TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX`: author pattern for `github my-open-prs`, with no control characters
- `TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES`: JSON array of branch names excluded from PR discovery, with no surrounding whitespace around the JSON value and no control characters in each branch name
- `HOME`: when used to derive the credentials base directory or expand `~/...` Git/search-root paths, it must not include surrounding whitespace or control characters; absolute override paths do not depend on `HOME`
- `XDG_CONFIG_HOME` and `APPDATA`: when used to derive the credentials base directory, they must not include surrounding whitespace or control characters
- `TRIAGE_COMPANION_SNYK_API_BASE_URL`: Snyk REST API base URL override; allowed US values are `https://api.snyk.io/rest` and `https://api.us.snyk.io/rest`
- `TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS`: comma-separated Snyk organization IDs to include, with no surrounding whitespace on each ID
- `GITHUB_TOKEN`: GitHub token used when no token is persisted
- `SNYK_TOKEN`: Snyk token used when no token is persisted
- `JIRA_BASE_URL`: Jira base URL override
- `JIRA_EMAIL`: Jira email override
- `JIRA_API_TOKEN`: Jira API token override

`github my-open-prs` uses local `git config user.name` and `user.email` as the branch author identity. If both values are unavailable, it uses the GitHub login inferred from the configured GitHub token when available.
Persisted GitHub and Snyk tokens take precedence over their token environment variables.
Removing saved credentials does not unset environment-based credentials; if the corresponding env vars are still set, they remain effective after the saved values are removed.
Credential env overrides with surrounding whitespace, blank values, or control characters are treated as invalid, so related commands fail until you fix or unset them.
Saved GitHub/Snyk tokens and saved Jira email/token values follow the same rule and are rejected instead of being trimmed silently.
If `secrets.json` cannot be read or parsed, commands report that configuration error instead of using environment tokens or default persisted settings.
If `TRIAGE_COMPANION_SNYK_API_BASE_URL` or `JIRA_BASE_URL` is set but invalid, including with surrounding whitespace, it still overrides saved settings and the related commands fail until you fix or unset it.
Home-relative paths are supported for `TRIAGE_COMPANION_CONFIG_DIR`, `TRIAGE_COMPANION_GIT`, and Git search root values.
Pass `--github-login <login>` to override the inferred account, using the exact login text with no surrounding whitespace, or `--author-regex <pattern>` if you need a custom branch-author match. An explicit empty `--author-regex ""` is rejected instead of being treated like the option was omitted.

## Output behavior

Tables are link-first.
The direct link is shown in the first column and treated as the most important field.
Long links are not truncated in normal width terminals.
If the terminal is narrow, the CLI switches to a stacked layout so links stay visible instead of being cut off.
`config show` reports canonical Jira and Snyk base URLs after normalization for valid settings, so values like `example.atlassian.net` or mixed-case Snyk hosts are shown in the effective form the CLI uses. Invalid raw overrides stay visible so you can see the exact bad value, but embedded control characters are escaped and base URLs with embedded credentials are redacted instead of echoed back.
Commands with `--json` always emit JSON, including empty result sets.
GitHub and Snyk commands that follow paginated API results fail if the API repeats a page link or returns an empty non-final page, instead of silently truncating the result set.
GitHub pagination links with surrounding whitespace are rejected instead of being normalized into valid-looking API URLs.
`snyk issues` also fails if the `status=open` API query returns a non-open issue row, instead of silently mixing it into the open-issues result set.
GitHub `failed-workflows` and `security-alerts` also fail if GitHub returns items outside the requested `failure` or `open` filter, instead of silently dropping or misreporting them.
`jira tickets` also fails if the unresolved-ticket query returns a resolved issue row, instead of silently mixing it into the open-ticket result set.
GitHub `notifications` likewise fails if an unread-only fetch returns read notifications, instead of silently mixing them into the default unread view.
CheckSuite and Discussion notifications have no per-item GitHub web page, so their links point to the repository Actions and Discussions pages.
Raw GitHub, Jira, and Snyk API error text, and direct GitHub, Jira, and Snyk fetch/network failure text, are flattened and control characters are escaped before they are shown in terminal output.
Local Git repository paths with control characters are rejected instead of being rendered into `git` and `github my-open-prs` output.
Malformed local Git branch headers and changed paths with control characters are rejected instead of being rendered into `git` output.
Top-level CLI and menu error wrappers, menu setup/config repair notices, and `status` / `config show` error lines also escape control characters before writing terminal output.

## Commands

```sh
triage-companion status
triage-companion menu
triage-companion config show
triage-companion config git-search-roots <paths-json>
triage-companion config reset-git-search-roots
triage-companion github token <token>
triage-companion github remove-token
triage-companion github notifications [--all] [--limit <n>] [--json]
triage-companion github mark-read <notification-id>
triage-companion github my-open-prs [paths...] [--search-roots <paths-json>] [--json]
triage-companion github my-open-prs --github-login <login>
triage-companion github my-open-prs --author-regex <pattern>
triage-companion github security-alerts [owner/repo...] [--json]
triage-companion github failed-workflows [owner/repo...] [--limit <n>] [--json]
triage-companion snyk token <token>
triage-companion snyk remove-token
triage-companion snyk issues [--severity high] [--json]
triage-companion snyk api-base-url <url>
triage-companion snyk reset-api-base-url
triage-companion jira credentials https://your-company.atlassian.net user@your-company.com <token>
triage-companion jira remove-credentials
triage-companion jira tickets [--json]
triage-companion git dirty [--limit <n>] [--search <query>] [--json]
triage-companion git status [--search <query>]
```

`snyk issues --severity` accepts only `critical`, `high`, `medium`, or `low`; explicit empty or whitespace-padded values are rejected.
All `--limit` options accept only positive integers with no surrounding whitespace.
`git dirty` prints a notice when more matching repositories exist than `--limit` shows, and `git status` lists every dirty repository without a cap.
Git `dirty --search` and `status --search` match repository name, branch, or path, and only run full status output for repositories that match.
Blank search queries are invalid.

## Troubleshooting: configured but a command still asks questions

- Check `triage-companion status` first for service availability, then `triage-companion config show` for configured values without exposing secrets.
- If credentials were saved to the wrong config directory, set `TRIAGE_COMPANION_CONFIG_DIR` to the directory that contains `secrets.json`.
- If `github my-open-prs` asks for identity details, confirm local `git config user.name`/`user.email` or a GitHub token is configured. If local git identity does not match the branch author, pass `--github-login <login>` or `--author-regex <pattern>`.
- If Jira still asks for the base URL, make sure you saved the site root, not a `/browse/...` page.
- If Git search roots look wrong, check `TRIAGE_COMPANION_GIT_SEARCH_ROOTS`. A non-empty JSON array overrides stored roots and defaults entirely, `[]` disables search-root discovery, and a blank value is ignored.
- If Snyk or Jira still prompt, verify the corresponding token or credentials were saved through the CLI and not only exported in the shell that launched one command.

## Development

Run tests (the interactive-menu test requires the `expect` binary on macOS/Linux, for example `apt-get install expect`):

```sh
npm test
```

Run type checking:

```sh
npm run typecheck
```

Run lint checks:

```sh
npm run lint
```

Check source file length limits (CI enforces a 500-line maximum per code file):

```sh
npm run check:file-lines
```

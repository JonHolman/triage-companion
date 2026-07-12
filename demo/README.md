# Live Terminal Demo

This demo records a real `triage-companion` terminal walkthrough with throwaway GitHub, Snyk, and Jira accounts.

Generated run data is written under `~/data/triage-companion-demo`. Tokens are never committed and should not be placed in this repo.

To create the provider tokens and record the safe setup captures, run:

```sh
/Applications/jonBrowser.app/Contents/MacOS/jonBrowser --serve-window
node demo/token-setup/record-token-setup.ts
```

Sign in to GitHub and Snyk in that visible jonBrowser window before running the recorder. The runner uses the visible browser for those token pages and writes the generated values directly to `~/data/triage-companion-demo/demo.env`.

If Atlassian asks for email step-up, the first run requests the one-time passcode and exits. Re-run with the code:

```sh
TRIAGE_COMPANION_DEMO_ATLASSIAN_STEP_UP_CODE=12345678 node demo/token-setup/record-token-setup.ts
```

The runner writes `~/data/triage-companion-demo/demo.env` with mode `0600`. Setup screenshots are written as PDFs under `~/data/triage-companion-demo/token-creation/runs/`; they stop before generated token values are shown.

## Credentials

The generated `~/data/triage-companion-demo/demo.env` has this shape:

```sh
export TRIAGE_COMPANION_DEMO_GITHUB_SETUP_TOKEN=''
export TRIAGE_COMPANION_DEMO_GITHUB_RUNTIME_TOKEN=''
export TRIAGE_COMPANION_DEMO_SNYK_TOKEN=''
export TRIAGE_COMPANION_DEMO_JIRA_BASE_URL='https://your-site.atlassian.net'
export TRIAGE_COMPANION_DEMO_JIRA_EMAIL='triage-companion-demo@jonholman.com'
export TRIAGE_COMPANION_DEMO_JIRA_API_TOKEN=''
export TRIAGE_COMPANION_DEMO_JIRA_CLOUD_ID=''
export TRIAGE_COMPANION_DEMO_JIRA_SETUP_API_TOKEN=''
```

Optional:

```sh
export TRIAGE_COMPANION_DEMO_RUN_GITHUB_ACTIONS=1
export TRIAGE_COMPANION_DEMO_GITHUB_ACTOR_TOKEN=''
```

`TRIAGE_COMPANION_DEMO_RUN_GITHUB_ACTIONS=1` triggers one intentionally failing GitHub Actions run in the demo repo. It consumes a small amount of the demo account's included GitHub Actions minutes.

`TRIAGE_COMPANION_DEMO_GITHUB_ACTOR_TOKEN` should belong to a second throwaway GitHub account. When set, setup creates an issue from that account mentioning the main demo account, which makes the notifications view more interesting.

## Minimum Token Permissions

For GitHub, create two classic personal access tokens on the demo account:

- Runtime token: `notifications` and `security_events`.
- Setup token: `public_repo` and `security_events`.

The runtime token is what `triage-companion` saves during the recorded setup. The setup token creates the public demo repo, writes demo files, opens a PR, and enables Dependabot alerts. Leave `TRIAGE_COMPANION_DEMO_RUN_GITHUB_ACTIONS` unset for the least-privilege recording; GitHub's classic `workflow` scope also selects broad `repo` access. If `github failed-workflows` returns `403` against a public demo repo, add `public_repo` to the runtime token; private demo repos require broader `repo` access and are not recommended for this recording.

For Snyk, the setup runner captures the demo account token from the Snyk account token page. The setup script runs `snyk monitor` against a local package with an intentionally old dependency, so the token needs access to create/read projects in the demo Snyk organization.

For Jira, the setup runner creates scoped Atlassian API tokens after email step-up. The runtime token uses Jira read scopes. The setup token adds `write:jira-work` and `manage:jira-configuration` so it can create the demo project and issue before the recording. The runner also discovers `TRIAGE_COMPANION_DEMO_JIRA_CLOUD_ID`; the CLI keeps the Jira site URL for browser links and uses `api.atlassian.com/ex/jira/{cloudId}` for scoped-token API calls.

## Record

From the repo root:

```sh
node demo/record-live-demo.ts
```

The recorder writes a GIF to `~/data/triage-companion-demo/recordings/`.

Each run creates a new timestamped directory under `~/data/triage-companion-demo/runs/`. Those directories include an isolated `TRIAGE_COMPANION_CONFIG_DIR`, so they contain the demo credentials saved during the recording.

## What The Demo Seeds

- A public GitHub repo in the demo account with a vulnerable Node manifest, one open PR, and optionally one failed workflow run.
- A local dirty Git repo for `git dirty` and `git status`.
- A Snyk monitored project created from the vulnerable Node manifest.
- A Jira project key `TCD`, if it does not already exist, and one unresolved task assigned to the demo user.

The scripts do not delete old GitHub repositories, Jira issues, Snyk projects, or local run directories.

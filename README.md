# Triage Companion CLI

Triage Companion is a terminal tool for checking GitHub notifications, GitHub Dependabot alerts, Snyk issues, Jira tickets, and local Git repository state.

## Setup

Install dependencies:

```sh
npm install
```

Run the CLI from this checkout:

```sh
npm start -- status
```

Link the `triage-companion` command locally:

```sh
npm link
triage-companion status
```

## Credentials

Credentials are stored in the local user config directory shown by `triage-companion status`. Set `TRIAGE_COMPANION_CONFIG_DIR` to use a different directory.

Configure services with commands:

```sh
triage-companion github token <token>
triage-companion snyk token <token>
triage-companion jira credentials <base-url> <email> <token>
```

Environment variables are also supported:

```sh
GITHUB_TOKEN=<token>
SNYK_TOKEN=<token>
JIRA_BASE_URL=https://example.atlassian.net
JIRA_EMAIL=user@example.com
JIRA_API_TOKEN=<token>
```

## Commands

```sh
triage-companion status
triage-companion github notifications
triage-companion github mark-read <notification-id>
triage-companion github my-open-prs
triage-companion github security-alerts [owner/repo...]
triage-companion snyk issues
triage-companion jira tickets
triage-companion git dirty
triage-companion git status
```

## Configuration

Optional environment variables:

- `TRIAGE_COMPANION_CONFIG_DIR`: directory for `secrets.json`
- `TRIAGE_COMPANION_GIT`: path to the Git binary
- `TRIAGE_COMPANION_GIT_SEARCH_ROOTS`: colon-separated roots scanned by Git commands
- `TRIAGE_COMPANION_GITHUB_PR_AUTHOR_REGEX`: author pattern for `github my-open-prs`
- `TRIAGE_COMPANION_GITHUB_PR_IGNORE_BRANCHES`: comma-separated branch names excluded from PR discovery
- `TRIAGE_COMPANION_SNYK_ORGANIZATION_IDS`: comma-separated Snyk organization IDs to include

## Development

Run tests:

```sh
npm test
```

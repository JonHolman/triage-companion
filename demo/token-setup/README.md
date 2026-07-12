# Token Setup Browser Demo

This demo uses jonBrowser to create the throwaway provider tokens for the live terminal demo and write them to `~/data/triage-companion-demo/demo.env`. It captures token values through jonBrowser automation and does not print them.

Run it from this repo:

```sh
/Applications/jonBrowser.app/Contents/MacOS/jonBrowser --serve-window
node demo/token-setup/record-token-setup.ts
```

Sign in to GitHub and Snyk in the visible jonBrowser window before running the recorder. The default visible automation port is `17365`; set `JONBROWSER_VISIBLE_PORT` before launching jonBrowser if you need a different port.

The runner writes generated browser scripts into a new timestamped directory under `~/data/triage-companion-demo/token-creation/runs/` and runs the Atlassian step-up script with `swift run BrowserCLI script` from `~/repos/personal/jonBrowser`. GitHub and Snyk run through the visible browser socket so the one-time token reveal happens in the signed-in browser surface. Generated PDFs are written into that same timestamped run directory before token values are revealed.

Atlassian can require email step-up before token creation. When that happens, the first run requests the one-time passcode and exits. Re-run with the code in the environment:

```sh
TRIAGE_COMPANION_DEMO_ATLASSIAN_STEP_UP_CODE=12345678 node demo/token-setup/record-token-setup.ts
```

The generated `.env` file is written with mode `0600`. Scratch token files under the timestamped run directory are removed after the env file is written.

Render a watchable MP4 and GIF from the latest browser setup run with:

```sh
node demo/token-setup/render-token-setup-video.ts
```

Pass a run directory as the first argument to render a specific capture, for example `node demo/token-setup/render-token-setup-video.ts ~/data/triage-companion-demo/token-creation/runs/2026-07-11T07-59-36Z`. Videos are written under `~/data/triage-companion-demo/token-creation/videos/`.

## Least-Privilege Settings

GitHub uses classic personal access tokens for this demo because `triage-companion` has one GitHub token slot and the notification endpoints require classic-token coverage for `notifications`.

- Runtime token: `notifications`, `security_events`, 7-day expiration.
- Setup token: `public_repo`, `security_events`, 7-day expiration.

The runtime token is saved by the terminal demo. The setup token seeds the public demo repository, writes the intentionally vulnerable manifest, opens a PR, and configures Dependabot alerts. Do not create private demo repos for this recording; that would require broader `repo` access.

Leave `TRIAGE_COMPANION_DEMO_RUN_GITHUB_ACTIONS` unset for the least-privilege recording. If you enable the optional failing workflow run, GitHub's classic `workflow` scope also selects broad `repo` access, so that path is intentionally outside the least-privilege token setup demo.

Snyk uses the demo account token from the account token page. Keep the account limited to the demo organization and projects. The CLI needs to list organizations, projects, and issues; the setup script also uses the Snyk CLI to create a monitored project from the local vulnerable manifest.

Atlassian uses scoped API tokens for Jira. The setup runner discovers the Jira site URL and Cloud ID through Atlassian's app-switcher API, creates a runtime token with Jira read scopes, and creates a setup token with `write:jira-work` and `manage:jira-configuration` so it can seed the demo project and issue.

## Provider Pages

- GitHub classic PATs: `https://github.com/settings/tokens/new`
- Snyk account token page: `https://app.snyk.io/account/personal-access-tokens`
- Atlassian API tokens: `https://id.atlassian.com/manage-profile/security/api-tokens`

Official references checked for the July 11, 2026 setup:

- GitHub says fine-grained tokens have stronger resource and permission limits, but not every classic-token feature is supported yet: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- GitHub Dependabot alert API accepts fine-grained tokens with `Dependabot alerts: read`, but the combined runtime demo still needs classic notification access: https://docs.github.com/en/rest/dependabot/alerts
- Snyk documents personal access tokens and read-only control through service accounts/group viewer where supported: https://docs.snyk.io/developer-tools/snyk-api/authentication-for-api/personal-access-tokens-pats
- Atlassian documents scoped tokens, unscoped tokens, 1-to-365-day expirations, and the `api.atlassian.com/ex/jira/{cloudId}` route required for scoped Jira tokens: https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/

# Contributor instructions

- Use Node 26 or newer.
- Execute TypeScript directly with `node`; do not add a local build step.
- Keep source code in `src` as `.ts` files.
- Use `npm start -- <command>` for local CLI development.
- The package binary is `triage-companion` and points at `src/index.ts`.
- Do not print secret values. Credentials are persisted through `src/credential-store.ts`.
- Keep Snyk API access on the supported US-hosted REST API base URLs.
- Keep Git search defaults in `DEFAULT_SEARCH_ROOTS` in `src/config-model.ts`.
- Update `README.md` when user-facing CLI behavior changes.

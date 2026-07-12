Set Shell "zsh"
Set FontSize 16
Set Width 1000
Set Height 620
Set Padding 20
Set TypingSpeed 35ms

Hide
Type 'set -a; source "$HOME/data/triage-companion-demo/demo.env"; set +a'
Enter
Sleep 1
Type 'eval "$(node demo/seed-live-demo.ts --shell)" && echo "TRIAGE_DEMO_SEED""_READY"'
Enter
Wait+Screen@600s /TRIAGE_DEMO_SEED_READY/
Sleep 1
Type "alias tc='node src/index.ts'"
Enter
Type "clear"
Enter
Show
Sleep 1

Type 'tc github token "$TRIAGE_COMPANION_DEMO_GITHUB_RUNTIME_TOKEN"'
Enter
Sleep 2
Type 'tc snyk token "$TRIAGE_COMPANION_DEMO_SNYK_TOKEN"'
Enter
Sleep 2
Type "tc snyk api-base-url https://api.snyk.io/rest"
Enter
Sleep 1
Type 'tc jira credentials "$TRIAGE_COMPANION_DEMO_JIRA_BASE_URL" "$TRIAGE_COMPANION_DEMO_JIRA_EMAIL" "$TRIAGE_COMPANION_DEMO_JIRA_API_TOKEN" "$TRIAGE_COMPANION_DEMO_JIRA_CLOUD_ID"'
Enter
Sleep 2

Type "tc status"
Enter
Sleep 3
Type "tc config show"
Enter
Sleep 3

Type "tc git dirty --search demo"
Enter
Sleep 2
Type "tc git status --search demo"
Enter
Sleep 3

Type 'tc github my-open-prs "$TRIAGE_COMPANION_DEMO_LOCAL_REPO" --github-login "$TRIAGE_COMPANION_DEMO_GITHUB_LOGIN"'
Enter
Sleep 3
Type "tc github notifications --limit 5"
Enter
Sleep 3
Type 'tc github security-alerts "$TRIAGE_COMPANION_DEMO_GITHUB_REPOSITORY"'
Enter
Sleep 3
Type 'tc github failed-workflows "$TRIAGE_COMPANION_DEMO_GITHUB_REPOSITORY"'
Enter
Sleep 3

Type "tc snyk issues --severity high"
Enter
Sleep 4
Type "tc jira tickets"
Enter
Sleep 4

Type 'echo "Demo artifacts: $TRIAGE_COMPANION_DEMO_ROOT"'
Enter
Sleep 3

import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published var draft = CredentialDraft()
    @Published var credentialStatuses: [ServiceCredentialStatus] = []
    @Published var settingsMessage: String?
    @Published var isSavingSettings = false

    @Published var notifications: LoadState<[GitHubNotificationItem]> = .idle
    @Published var dependabotAlerts: LoadState<[DependabotAlertItem]> = .idle
    @Published var failedWorkflows: LoadState<[FailedWorkflowRunItem]> = .idle
    @Published var snykIssues: LoadState<[SnykIssueItem]> = .idle
    @Published var jiraTickets: LoadState<[JiraTicketItem]> = .idle

    @Published var hasSavedGitHubToken = false
    @Published var hasSavedSnykToken = false
    @Published var hasSavedJiraToken = false

    private let store: CredentialStoring

    init(store: CredentialStoring = AppCredentialStore()) {
        self.store = store
        reloadCredentials()
    }

    func reloadCredentials() {
        do {
            let snapshot = try credentialSnapshot()
            hasSavedGitHubToken = snapshot.githubToken != nil
            hasSavedSnykToken = snapshot.snykToken != nil
            hasSavedJiraToken = snapshot.jiraAPIToken != nil
            draft.githubToken = ""
            draft.snykToken = ""
            draft.jiraAPIToken = ""
            draft.snykAPIBaseURL = snapshot.snykAPIBaseURL
            draft.jiraBaseURL = snapshot.jiraBaseURL ?? ""
            draft.jiraEmail = snapshot.jiraEmail ?? ""
            draft.jiraCloudID = snapshot.jiraCloudID ?? ""
            credentialStatuses = [
                ServiceCredentialStatus(
                    service: .github,
                    isConfigured: snapshot.hasGitHub,
                    detail: snapshot.hasGitHub ? "Token saved" : "Token required"
                ),
                ServiceCredentialStatus(
                    service: .snyk,
                    isConfigured: snapshot.hasSnyk,
                    detail: snapshot.hasSnyk ? "Token saved" : "Token required"
                ),
                ServiceCredentialStatus(
                    service: .jira,
                    isConfigured: snapshot.hasJira,
                    detail: snapshot.hasJira ? "Credentials saved" : "Base URL, email, and token required"
                )
            ]
        } catch {
            settingsMessage = errorMessage(error)
        }
    }

    func saveSettings() async {
        isSavingSettings = true
        defer { isSavingSettings = false }

        do {
            if !draft.githubToken.isEmpty {
                try store.save(try cleanRequiredText(draft.githubToken, label: "GitHub token"), for: .githubToken)
            }
            if !draft.snykToken.isEmpty {
                try store.save(try cleanRequiredText(draft.snykToken, label: "Snyk token"), for: .snykToken)
            }
            try store.save(try normalizedSnykAPIBaseURL(draft.snykAPIBaseURL), for: .snykAPIBaseURL)

            let hasJiraInput = !draft.jiraBaseURL.isEmpty || !draft.jiraEmail.isEmpty || !draft.jiraAPIToken.isEmpty || !draft.jiraCloudID.isEmpty
            if hasJiraInput {
                try store.save(try normalizedJiraBaseURL(draft.jiraBaseURL), for: .jiraBaseURL)
                try store.save(try cleanRequiredText(draft.jiraEmail, label: "Jira email"), for: .jiraEmail)
                if !draft.jiraAPIToken.isEmpty {
                    try store.save(try cleanRequiredText(draft.jiraAPIToken, label: "Jira API token"), for: .jiraAPIToken)
                } else if try store.read(.jiraAPIToken) == nil {
                    throw TriageCompanionError.message("Jira API token is required.")
                }
                try store.save(try validateCloudID(draft.jiraCloudID), for: .jiraCloudID)
            }

            settingsMessage = "Settings saved."
            reloadCredentials()
        } catch {
            settingsMessage = errorMessage(error)
        }
    }

    func removeGitHubToken() {
        do {
            try store.save(nil, for: .githubToken)
            settingsMessage = "GitHub token removed."
            reloadCredentials()
        } catch {
            settingsMessage = errorMessage(error)
        }
    }

    func removeSnykToken() {
        do {
            try store.save(nil, for: .snykToken)
            settingsMessage = "Snyk token removed."
            reloadCredentials()
        } catch {
            settingsMessage = errorMessage(error)
        }
    }

    func clearJiraCredentials() {
        do {
            try store.save(nil, for: .jiraBaseURL)
            try store.save(nil, for: .jiraEmail)
            try store.save(nil, for: .jiraAPIToken)
            try store.save(nil, for: .jiraCloudID)
            settingsMessage = "Jira credentials cleared."
            reloadCredentials()
        } catch {
            settingsMessage = errorMessage(error)
        }
    }

    func refreshAll() async {
        await refreshGitHub()
        await refreshSnyk()
        await refreshJira()
    }

    func refreshGitHub() async {
        let snapshot: CredentialSnapshot
        do {
            snapshot = try credentialSnapshot()
        } catch {
            let message = errorMessage(error)
            notifications = .failed(message)
            dependabotAlerts = .failed(message)
            failedWorkflows = .failed(message)
            return
        }

        guard let token = snapshot.githubToken else {
            let message = "Save a GitHub token in Settings."
            notifications = .notConfigured(message)
            dependabotAlerts = .notConfigured(message)
            failedWorkflows = .notConfigured(message)
            return
        }

        let client = GitHubClient(token: token)
        notifications = .loading
        dependabotAlerts = .loading
        failedWorkflows = .loading
        do {
            let checkedAt = Date()
            notifications = .loaded(try await client.listNotifications(), checkedAt)
            dependabotAlerts = .loaded(try await client.listDependabotAlertsFromNotifications(), Date())
            failedWorkflows = .loaded(try await client.listFailedWorkflowRunsFromNotifications(), Date())
        } catch {
            let message = errorMessage(error)
            if case .loading = notifications {
                notifications = .failed(message)
            }
            if case .loading = dependabotAlerts {
                dependabotAlerts = .failed(message)
            }
            if case .loading = failedWorkflows {
                failedWorkflows = .failed(message)
            }
        }
    }

    func refreshSnyk() async {
        let snapshot: CredentialSnapshot
        do {
            snapshot = try credentialSnapshot()
        } catch {
            snykIssues = .failed(errorMessage(error))
            return
        }

        guard let token = snapshot.snykToken else {
            snykIssues = .notConfigured("Save a Snyk token in Settings.")
            return
        }

        snykIssues = .loading
        do {
            let client = try SnykClient(token: token, baseURL: snapshot.snykAPIBaseURL)
            snykIssues = .loaded(try await client.listOpenIssues(), Date())
        } catch {
            snykIssues = .failed(errorMessage(error))
        }
    }

    func refreshJira() async {
        let snapshot: CredentialSnapshot
        do {
            snapshot = try credentialSnapshot()
        } catch {
            jiraTickets = .failed(errorMessage(error))
            return
        }

        guard let baseURL = snapshot.jiraBaseURL,
              let email = snapshot.jiraEmail,
              let apiToken = snapshot.jiraAPIToken else {
            jiraTickets = .notConfigured("Save Jira credentials in Settings.")
            return
        }

        jiraTickets = .loading
        do {
            let client = try JiraClient(
                baseURL: baseURL,
                email: email,
                apiToken: apiToken,
                cloudID: snapshot.jiraCloudID
            )
            jiraTickets = .loaded(try await client.listOpenTickets(), Date())
        } catch {
            jiraTickets = .failed(errorMessage(error))
        }
    }

    private func credentialSnapshot() throws -> CredentialSnapshot {
        let snykAPIBaseURL = try normalizedSnykAPIBaseURL(try store.read(.snykAPIBaseURL) ?? defaultSnykAPIBaseURL)
        let cloudID = try validateCloudID(try store.read(.jiraCloudID) ?? "")

        return CredentialSnapshot(
            githubToken: try storedRequiredText(.githubToken, label: "GitHub token"),
            snykToken: try storedRequiredText(.snykToken, label: "Snyk token"),
            snykAPIBaseURL: snykAPIBaseURL,
            jiraBaseURL: try storedNormalizedJiraBaseURL(),
            jiraEmail: try storedRequiredText(.jiraEmail, label: "Jira email"),
            jiraAPIToken: try storedRequiredText(.jiraAPIToken, label: "Jira API token"),
            jiraCloudID: cloudID
        )
    }

    private func storedRequiredText(_ key: CredentialKey, label: String) throws -> String? {
        guard let value = try store.read(key) else {
            return nil
        }

        return try cleanRequiredText(value, label: label)
    }

    private func storedNormalizedJiraBaseURL() throws -> String? {
        guard let value = try store.read(.jiraBaseURL) else {
            return nil
        }

        return try normalizedJiraBaseURL(value)
    }

    private func errorMessage(_ error: Error) -> String {
        if let localized = error as? LocalizedError, let description = localized.errorDescription {
            return description
        }

        return error.localizedDescription
    }
}

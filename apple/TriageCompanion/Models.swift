import Foundation

enum ServiceID: String, CaseIterable, Identifiable {
    case github
    case snyk
    case jira

    var id: String { rawValue }

    var name: String {
        switch self {
        case .github:
            return "GitHub"
        case .snyk:
            return "Snyk"
        case .jira:
            return "Jira"
        }
    }

    var symbolName: String {
        switch self {
        case .github:
            return "bell.badge"
        case .snyk:
            return "shield.lefthalf.filled"
        case .jira:
            return "checklist"
        }
    }
}

struct ServiceCredentialStatus: Identifiable {
    let service: ServiceID
    let isConfigured: Bool
    let detail: String

    var id: ServiceID { service }
}

struct GitHubNotificationItem: Identifiable {
    let id: String
    let repository: String
    let title: String
    let reason: String
    let type: String
    let isUnread: Bool
    let updatedAt: Date
    let url: URL
}

struct DependabotAlertItem: Identifiable {
    let id: String
    let repository: String
    let packageName: String
    let severity: String
    let summary: String
    let patchedVersion: String?
    let url: URL
}

struct FailedWorkflowRunItem: Identifiable {
    let id: String
    let repository: String
    let workflowName: String
    let title: String
    let branch: String?
    let updatedAt: Date
    let url: URL
}

struct SnykIssueItem: Identifiable {
    let id: String
    let organizationName: String
    let projectName: String
    let packageName: String?
    let severity: String
    let issueType: String
    let title: String
    let updatedAt: Date
    let url: URL
}

struct JiraTicketItem: Identifiable {
    let id: String
    let key: String
    let issueType: String
    let status: String
    let priority: String?
    let reporter: String?
    let updatedAt: Date
    let summary: String
    let url: URL
}

struct CredentialDraft {
    var githubToken = ""
    var snykToken = ""
    var snykAPIBaseURL = "https://api.snyk.io/rest"
    var jiraBaseURL = ""
    var jiraEmail = ""
    var jiraAPIToken = ""
    var jiraCloudID = ""
}

struct CredentialSnapshot {
    let githubToken: String?
    let snykToken: String?
    let snykAPIBaseURL: String
    let jiraBaseURL: String?
    let jiraEmail: String?
    let jiraAPIToken: String?
    let jiraCloudID: String?

    var hasGitHub: Bool {
        githubToken != nil
    }

    var hasSnyk: Bool {
        snykToken != nil
    }

    var hasJira: Bool {
        jiraBaseURL != nil && jiraEmail != nil && jiraAPIToken != nil
    }
}

enum LoadState<Value> {
    case idle
    case loading
    case notConfigured(String)
    case loaded(Value, Date)
    case failed(String)

    var checkedAt: Date? {
        if case let .loaded(_, checkedAt) = self {
            return checkedAt
        }

        return nil
    }

    var errorText: String? {
        switch self {
        case let .failed(message), let .notConfigured(message):
            return message
        case .idle, .loading, .loaded:
            return nil
        }
    }
}

enum TriageCompanionError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case let .message(message):
            return message
        }
    }
}

let defaultSnykAPIBaseURL = "https://api.snyk.io/rest"
let alternateSnykAPIBaseURL = "https://api.us.snyk.io/rest"

func cleanRequiredText(_ value: String, label: String) throws -> String {
    if value.trimmingCharacters(in: .whitespacesAndNewlines) != value {
        throw TriageCompanionError.message("\(label) must not include surrounding whitespace.")
    }
    if value.isEmpty {
        throw TriageCompanionError.message("\(label) is required.")
    }
    if value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) {
        throw TriageCompanionError.message("\(label) must not include control characters.")
    }

    return value
}

func optionalCleanText(_ value: String, label: String) throws -> String? {
    if value.isEmpty {
        return nil
    }

    return try cleanRequiredText(value, label: label)
}

func normalizedSnykAPIBaseURL(_ value: String) throws -> String {
    let text = try cleanRequiredText(value, label: "Snyk API base URL")
    guard let url = URL(string: text), url.scheme == "https", url.user == nil, url.password == nil, url.port == nil else {
        throw TriageCompanionError.message("Snyk API base URL must be a valid https URL without credentials or a port.")
    }

    let normalized = url.absoluteString.hasSuffix("/") ? String(url.absoluteString.dropLast()) : url.absoluteString
    guard normalized == defaultSnykAPIBaseURL || normalized == alternateSnykAPIBaseURL else {
        throw TriageCompanionError.message("Snyk API base URL must be \(defaultSnykAPIBaseURL) or \(alternateSnykAPIBaseURL).")
    }

    return normalized
}

func normalizedJiraBaseURL(_ value: String) throws -> String {
    let text = try cleanRequiredText(value, label: "Jira base URL")
    let valueWithScheme = text.contains("://") ? text : "https://\(text)"
    guard let url = URL(string: valueWithScheme), url.scheme == "https", url.user == nil, url.password == nil, url.port == nil else {
        throw TriageCompanionError.message("Jira base URL must be a valid https URL without credentials or a port.")
    }
    guard url.path.isEmpty || url.path == "/", url.query == nil, url.fragment == nil else {
        throw TriageCompanionError.message("Jira base URL must be the site root.")
    }

    return "\(url.scheme!)://\(url.host!)"
}

func validateCloudID(_ value: String) throws -> String? {
    guard let text = try optionalCleanText(value, label: "Jira Cloud ID") else {
        return nil
    }
    guard text.range(of: #"^[A-Za-z0-9._:-]+$"#, options: .regularExpression) != nil else {
        throw TriageCompanionError.message("Jira Cloud ID contains unsupported characters.")
    }

    return text
}

func parseServiceDate(_ value: String, label: String) throws -> Date {
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractionalFormatter.date(from: value) {
        return date
    }

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    if let date = formatter.date(from: value) {
        return date
    }

    throw TriageCompanionError.message("\(label) must be an ISO-8601 timestamp.")
}

func severityRank(_ severity: String) -> Int {
    switch severity.lowercased() {
    case "critical":
        return 4
    case "high":
        return 3
    case "medium":
        return 2
    case "low":
        return 1
    default:
        return 0
    }
}

func relativeTime(_ date: Date) -> String {
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .short
    return formatter.localizedString(for: date, relativeTo: Date())
}

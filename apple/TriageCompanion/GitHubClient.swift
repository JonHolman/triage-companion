import Foundation

struct GitHubClient {
    private let token: String
    private let http: HTTPClient
    private let apiBaseURL = URL(string: "https://api.github.com")!

    init(token: String, http: HTTPClient = HTTPClient()) {
        self.token = token
        self.http = http
    }

    func listNotifications(limit: Int = 50, includeRead: Bool = false) async throws -> [GitHubNotificationItem] {
        let notifications = try await fetchNotifications(limit: limit, includeRead: includeRead)
        return try notifications.map(notificationItem).sorted { $0.updatedAt > $1.updatedAt }
    }

    func markNotificationRead(_ id: String) async throws {
        guard id.range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil else {
            throw TriageCompanionError.message("GitHub notification ID must be a positive integer.")
        }

        let url = apiBaseURL
            .appendingPathComponent("notifications")
            .appendingPathComponent("threads")
            .appendingPathComponent(id)
        try await http.requestWithoutBody(
            request(url: url, method: "PATCH", headers: headers),
            serviceName: "GitHub"
        )
    }

    func listDependabotAlertsFromNotifications() async throws -> [DependabotAlertItem] {
        let repositories = try await securityAlertRepositories()
        return try await listDependabotAlerts(repositories: repositories)
    }

    func listFailedWorkflowRunsFromNotifications() async throws -> [FailedWorkflowRunItem] {
        let repositories = try await notificationRepositories()
        return try await listFailedWorkflowRuns(repositories: repositories, maxPerRepository: 5)
    }

    private var headers: [String: String] {
        [
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer \(token)",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "triage-companion",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
        ]
    }

    private func fetchNotifications(limit: Int, includeRead: Bool) async throws -> [GitHubNotificationAPI] {
        let pageSize = min(max(limit, 1), 100)
        var url = urlWithQuery(
            apiBaseURL.appendingPathComponent("notifications"),
            queryItems: [
                URLQueryItem(name: "all", value: includeRead ? "true" : "false"),
                URLQueryItem(name: "participating", value: "false"),
                URLQueryItem(name: "per_page", value: String(pageSize))
            ]
        )
        var items: [GitHubNotificationAPI] = []

        while items.count < limit {
            let (page, response) = try await http.decoded(
                [GitHubNotificationAPI].self,
                from: request(url: url, headers: headers),
                serviceName: "GitHub notifications"
            )
            items.append(contentsOf: page)
            if items.count >= limit {
                break
            }
            guard let next = try nextURL(from: response.value(forHTTPHeaderField: "Link")) else {
                break
            }
            if page.isEmpty {
                throw TriageCompanionError.message("GitHub notifications returned an empty page before pagination finished.")
            }
            url = next
        }

        return Array(items.prefix(limit))
    }

    private func notificationItem(_ notification: GitHubNotificationAPI) throws -> GitHubNotificationItem {
        let id = notification.id.value
        let updatedAt = try parseServiceDate(notification.updatedAt, label: "GitHub notification updated_at")
        return GitHubNotificationItem(
            id: id,
            repository: notification.repository.fullName,
            title: notification.subject.title,
            reason: notification.reason,
            type: notification.subject.type,
            isUnread: notification.unread,
            updatedAt: updatedAt,
            url: try webURL(for: notification)
        )
    }

    private func securityAlertRepositories() async throws -> [String] {
        let notifications = try await fetchNotifications(limit: Int.max, includeRead: true)
        let repositories = notifications.compactMap { notification -> String? in
            if notification.subject.type == "RepositoryDependabotAlertsThread" || notification.reason == "security_alert" {
                return notification.repository.fullName
            }
            return nil
        }

        return Array(Set(repositories)).sorted()
    }

    private func notificationRepositories() async throws -> [String] {
        let notifications = try await fetchNotifications(limit: Int.max, includeRead: true)
        return Array(Set(notifications.map(\.repository.fullName))).sorted()
    }

    private func listDependabotAlerts(repositories: [String]) async throws -> [DependabotAlertItem] {
        var alerts: [DependabotAlertItem] = []
        for repository in repositories {
            let path = try repositoryAPIPath(repository)
            var url = urlWithQuery(
                apiBaseURL
                    .appendingPathComponent("repos")
                    .appendingPathComponent(path)
                    .appendingPathComponent("dependabot")
                    .appendingPathComponent("alerts"),
                queryItems: [
                    URLQueryItem(name: "state", value: "open"),
                    URLQueryItem(name: "per_page", value: "100")
                ]
            )

            while true {
                let (page, response) = try await http.decoded(
                    [DependabotAlertAPI].self,
                    from: request(url: url, headers: headers),
                    serviceName: "GitHub Dependabot alerts"
                )
                alerts.append(contentsOf: try page.map { try dependabotAlertItem($0, repository: repository) })
                guard let next = try nextURL(from: response.value(forHTTPHeaderField: "Link")) else {
                    break
                }
                if page.isEmpty {
                    throw TriageCompanionError.message("GitHub Dependabot alerts returned an empty page before pagination finished.")
                }
                url = next
            }
        }

        return alerts.sorted {
            severityRank($0.severity) == severityRank($1.severity)
                ? $0.repository < $1.repository
                : severityRank($0.severity) > severityRank($1.severity)
        }
    }

    private func dependabotAlertItem(_ alert: DependabotAlertAPI, repository: String) throws -> DependabotAlertItem {
        guard alert.state == "open" else {
            throw TriageCompanionError.message("GitHub Dependabot alert response included a non-open alert.")
        }
        guard let url = URL(string: alert.htmlURL) else {
            throw TriageCompanionError.message("GitHub Dependabot alert response included an invalid URL.")
        }
        let packageName = alert.dependency.package?.name ?? alert.securityVulnerability.package?.name
        guard let packageName, !packageName.isEmpty else {
            throw TriageCompanionError.message("GitHub Dependabot alert response did not include a package name.")
        }
        let severity = alert.securityVulnerability.severity ?? alert.securityAdvisory.severity
        guard let severity, severityRank(severity) > 0 else {
            throw TriageCompanionError.message("GitHub Dependabot alert response included an unknown severity.")
        }

        return DependabotAlertItem(
            id: "\(repository)#\(alert.number)",
            repository: repository,
            packageName: packageName,
            severity: severity,
            summary: alert.securityAdvisory.summary,
            patchedVersion: alert.securityVulnerability.firstPatchedVersion?.identifier,
            url: url
        )
    }

    private func listFailedWorkflowRuns(
        repositories: [String],
        maxPerRepository: Int
    ) async throws -> [FailedWorkflowRunItem] {
        var runs: [FailedWorkflowRunItem] = []
        for repository in repositories {
            let path = try repositoryAPIPath(repository)
            var url = urlWithQuery(
                apiBaseURL
                    .appendingPathComponent("repos")
                    .appendingPathComponent(path)
                    .appendingPathComponent("actions")
                    .appendingPathComponent("runs"),
                queryItems: [
                    URLQueryItem(name: "status", value: "failure"),
                    URLQueryItem(name: "per_page", value: String(maxPerRepository))
                ]
            )
            var repositoryRuns: [FailedWorkflowRunItem] = []

            while repositoryRuns.count < maxPerRepository {
                let (page, response) = try await http.decoded(
                    WorkflowRunsResponse.self,
                    from: request(url: url, headers: headers),
                    serviceName: "GitHub workflow runs"
                )
                let pageRuns = try page.workflowRuns.map { try workflowRunItem($0, repository: repository) }
                repositoryRuns.append(contentsOf: pageRuns)
                if repositoryRuns.count >= maxPerRepository {
                    break
                }
                guard let next = try nextURL(from: response.value(forHTTPHeaderField: "Link")) else {
                    break
                }
                if page.workflowRuns.isEmpty {
                    throw TriageCompanionError.message("GitHub workflow runs returned an empty page before pagination finished.")
                }
                url = next
            }
            runs.append(contentsOf: repositoryRuns.prefix(maxPerRepository))
        }

        return runs.sorted { $0.updatedAt > $1.updatedAt }
    }

    private func workflowRunItem(_ run: WorkflowRunAPI, repository: String) throws -> FailedWorkflowRunItem {
        guard run.status == "completed", run.conclusion == "failure" else {
            throw TriageCompanionError.message("GitHub workflow run response included a non-failed run.")
        }
        guard let url = URL(string: run.htmlURL) else {
            throw TriageCompanionError.message("GitHub workflow run response included an invalid URL.")
        }

        return FailedWorkflowRunItem(
            id: "\(repository)#\(run.id)",
            repository: repository,
            workflowName: run.name,
            title: run.displayTitle,
            branch: run.headBranch,
            updatedAt: try parseServiceDate(run.updatedAt, label: "GitHub workflow run updated_at"),
            url: url
        )
    }

    private func webURL(for notification: GitHubNotificationAPI) throws -> URL {
        if let subjectURL = notification.subject.url, let apiURL = URL(string: subjectURL), apiURL.host == "api.github.com" {
            let parts = apiURL.pathComponents.filter { $0 != "/" }
            if parts.count == 5, parts[0] == "repos", parts[3] == "pulls" {
                return try githubWebURL(owner: parts[1], repository: parts[2], kind: "pull", number: parts[4])
            }
            if parts.count == 5, parts[0] == "repos", parts[3] == "issues" {
                return try githubWebURL(owner: parts[1], repository: parts[2], kind: "issues", number: parts[4])
            }
        }

        guard let repositoryURL = URL(string: notification.repository.htmlURL) else {
            throw TriageCompanionError.message("GitHub notification response included an invalid repository URL.")
        }
        return repositoryURL
    }

    private func githubWebURL(owner: String, repository: String, kind: String, number: String) throws -> URL {
        guard let url = URL(string: "https://github.com/\(encodedPathComponent(owner))/\(encodedPathComponent(repository))/\(kind)/\(encodedPathComponent(number))") else {
            throw TriageCompanionError.message("Could not build GitHub web URL.")
        }

        return url
    }

    private func repositoryAPIPath(_ fullName: String) throws -> String {
        let parts = fullName.split(separator: "/").map(String.init)
        guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else {
            throw TriageCompanionError.message("GitHub repository must be in owner/repo form.")
        }

        return "\(encodedPathComponent(parts[0]))/\(encodedPathComponent(parts[1]))"
    }
}

private struct FlexibleString: Decodable {
    let value: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            value = string
            return
        }
        if let integer = try? container.decode(Int.self) {
            value = String(integer)
            return
        }

        throw DecodingError.typeMismatch(
            String.self,
            DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Expected string or integer.")
        )
    }
}

private struct GitHubNotificationAPI: Decodable {
    let id: FlexibleString
    let repository: GitHubRepositoryAPI
    let subject: GitHubNotificationSubjectAPI
    let reason: String
    let updatedAt: String
    let unread: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case repository
        case subject
        case reason
        case updatedAt = "updated_at"
        case unread
    }
}

private struct GitHubRepositoryAPI: Decodable {
    let fullName: String
    let htmlURL: String

    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case htmlURL = "html_url"
    }
}

private struct GitHubNotificationSubjectAPI: Decodable {
    let title: String
    let type: String
    let url: String?
}

private struct DependabotAlertAPI: Decodable {
    let number: Int
    let state: String
    let htmlURL: String
    let dependency: DependabotDependencyAPI
    let securityAdvisory: DependabotAdvisoryAPI
    let securityVulnerability: DependabotVulnerabilityAPI

    enum CodingKeys: String, CodingKey {
        case number
        case state
        case htmlURL = "html_url"
        case dependency
        case securityAdvisory = "security_advisory"
        case securityVulnerability = "security_vulnerability"
    }
}

private struct DependabotDependencyAPI: Decodable {
    let package: DependabotPackageAPI?
}

private struct DependabotAdvisoryAPI: Decodable {
    let ghsaID: String
    let summary: String
    let severity: String?

    enum CodingKeys: String, CodingKey {
        case ghsaID = "ghsa_id"
        case summary
        case severity
    }
}

private struct DependabotVulnerabilityAPI: Decodable {
    let package: DependabotPackageAPI?
    let severity: String?
    let firstPatchedVersion: DependabotPatchedVersionAPI?

    enum CodingKeys: String, CodingKey {
        case package
        case severity
        case firstPatchedVersion = "first_patched_version"
    }
}

private struct DependabotPackageAPI: Decodable {
    let name: String
}

private struct DependabotPatchedVersionAPI: Decodable {
    let identifier: String
}

private struct WorkflowRunsResponse: Decodable {
    let workflowRuns: [WorkflowRunAPI]

    enum CodingKeys: String, CodingKey {
        case workflowRuns = "workflow_runs"
    }
}

private struct WorkflowRunAPI: Decodable {
    let id: Int
    let name: String
    let displayTitle: String
    let headBranch: String?
    let status: String
    let conclusion: String
    let htmlURL: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case displayTitle = "display_title"
        case headBranch = "head_branch"
        case status
        case conclusion
        case htmlURL = "html_url"
        case updatedAt = "updated_at"
    }
}

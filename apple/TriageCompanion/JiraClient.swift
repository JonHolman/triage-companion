import Foundation

struct JiraClient {
    private let settings: JiraSettings
    private let http: HTTPClient

    init(baseURL: String, email: String, apiToken: String, cloudID: String?, http: HTTPClient = HTTPClient()) throws {
        self.settings = JiraSettings(
            baseURL: try normalizedJiraBaseURL(baseURL),
            email: try cleanRequiredText(email, label: "Jira email"),
            apiToken: try cleanRequiredText(apiToken, label: "Jira API token"),
            cloudID: cloudID
        )
        self.http = http
    }

    func listOpenTickets() async throws -> [JiraTicketItem] {
        var tickets: [JiraTicketItem] = []
        var nextPageToken: String?
        var seenTokens: Set<String> = []
        var startAt = 0
        let pageSize = 100

        while true {
            var queryItems = [
                URLQueryItem(name: "jql", value: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC"),
                URLQueryItem(name: "fields", value: "summary,status,priority,issuetype,reporter,updated,resolution"),
                URLQueryItem(name: "maxResults", value: String(pageSize))
            ]
            if settings.apiKind == .dataCenter {
                queryItems.append(URLQueryItem(name: "startAt", value: String(startAt)))
            } else if let nextPageToken {
                queryItems.append(URLQueryItem(name: "nextPageToken", value: nextPageToken))
            }

            let url = urlWithQuery(try settings.routeURL(path: settings.searchPath), queryItems: queryItems)
            let (payload, _) = try await http.jsonObject(
                from: request(url: url, headers: settings.headers),
                serviceName: "Jira"
            )
            guard let issueRecords = payload["issues"] as? [[String: Any]] else {
                throw TriageCompanionError.message("Jira search response must include an issues array.")
            }
            if issueRecords.count > pageSize {
                throw TriageCompanionError.message("Jira search response exceeded the requested page size.")
            }
            for issue in issueRecords {
                tickets.append(try ticketItem(issue))
            }

            if settings.apiKind == .dataCenter {
                startAt += issueRecords.count
                let total = payload["total"] as? Int
                if issueRecords.isEmpty || issueRecords.count < pageSize || (total != nil && startAt >= total!) {
                    break
                }
            } else {
                guard let token = payload["nextPageToken"] as? String else {
                    break
                }
                let cleanToken = try cleanRequiredText(token, label: "Jira nextPageToken")
                if issueRecords.isEmpty {
                    throw TriageCompanionError.message("Jira search returned an empty page before pagination finished.")
                }
                if !seenTokens.insert(cleanToken).inserted {
                    throw TriageCompanionError.message("Jira search pagination repeated a page token.")
                }
                nextPageToken = cleanToken
            }
        }

        return tickets.sorted { $0.updatedAt > $1.updatedAt }
    }

    private func ticketItem(_ issue: [String: Any]) throws -> JiraTicketItem {
        let key = try issueKey(string(issue, key: "key", context: "Jira issue"))
        let fields = try object(issue, key: "fields", context: "Jira issue \(key)")
        if fields["resolution"] != nil, !(fields["resolution"] is NSNull) {
            throw TriageCompanionError.message("Jira issue \(key) was resolved.")
        }

        let issueType = try string(try object(fields, key: "issuetype", context: "Jira issue \(key)"), key: "name", context: "Jira issue \(key) type")
        let status = try string(try object(fields, key: "status", context: "Jira issue \(key)"), key: "name", context: "Jira issue \(key) status")
        let summary = try string(fields, key: "summary", context: "Jira issue \(key)")
        let updatedAt = try parseServiceDate(
            string(fields, key: "updated", context: "Jira issue \(key)"),
            label: "Jira issue updated"
        )
        let priority = (fields["priority"] as? [String: Any]).flatMap { try? string($0, key: "name", context: "Jira issue \(key) priority") }
        let reporterObject = fields["reporter"] as? [String: Any]
        let reporter = reporterObject.flatMap { reporter in
            (try? string(reporter, key: "displayName", context: "Jira issue \(key) reporter"))
                ?? (try? string(reporter, key: "emailAddress", context: "Jira issue \(key) reporter"))
        }
        guard let url = URL(string: "\(settings.baseURL)/browse/\(encodedPathComponent(key))") else {
            throw TriageCompanionError.message("Could not build Jira issue URL.")
        }

        return JiraTicketItem(
            id: key,
            key: key,
            issueType: issueType,
            status: status,
            priority: priority,
            reporter: reporter,
            updatedAt: updatedAt,
            summary: summary,
            url: url
        )
    }

    private func object(_ value: [String: Any], key: String, context: String) throws -> [String: Any] {
        guard let object = value[key] as? [String: Any] else {
            throw TriageCompanionError.message("\(context) must include \(key).")
        }

        return object
    }

    private func string(_ value: [String: Any], key: String, context: String) throws -> String {
        guard let stringValue = value[key] as? String else {
            throw TriageCompanionError.message("\(context) must include \(key).")
        }

        return try cleanRequiredText(stringValue, label: "\(context) \(key)")
    }

    private func issueKey(_ value: String) throws -> String {
        guard value.range(of: #"^[A-Za-z][A-Za-z0-9_]*-\d+$"#, options: .regularExpression) != nil else {
            throw TriageCompanionError.message("Jira issue key must use project-key-number format.")
        }

        return value.uppercased()
    }
}

private struct JiraSettings {
    let baseURL: String
    let email: String
    let apiToken: String
    let cloudID: String?

    var apiKind: JiraAPIKind {
        if cloudID != nil {
            return .cloud
        }
        guard let host = URL(string: baseURL)?.host?.lowercased() else {
            return .cloud
        }

        return host.hasSuffix(".atlassian.net") ? .cloud : .dataCenter
    }

    var searchPath: String {
        apiKind == .dataCenter ? "/rest/api/2/search" : "/rest/api/3/search/jql"
    }

    var headers: [String: String] {
        [
            "Authorization": authorizationHeader,
            "Accept": "application/json",
            "User-Agent": "triage-companion"
        ]
    }

    private var authorizationHeader: String {
        if apiKind == .dataCenter {
            return "Bearer \(apiToken)"
        }

        let encoded = Data("\(email):\(apiToken)".utf8).base64EncodedString()
        return "Basic \(encoded)"
    }

    func routeURL(path: String) throws -> URL {
        let apiBase: String
        if let cloudID {
            apiBase = "https://api.atlassian.com/ex/jira/\(encodedPathComponent(cloudID))"
        } else {
            apiBase = baseURL
        }
        guard let url = URL(string: "\(apiBase)\(path)") else {
            throw TriageCompanionError.message("Jira API route was invalid.")
        }

        return url
    }
}

private enum JiraAPIKind {
    case cloud
    case dataCenter
}

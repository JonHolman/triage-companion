import Foundation

struct SnykClient {
    private let token: String
    private let baseURL: URL
    private let http: HTTPClient

    init(token: String, baseURL: String, http: HTTPClient = HTTPClient()) throws {
        self.token = token
        guard let url = URL(string: try normalizedSnykAPIBaseURL(baseURL)) else {
            throw TriageCompanionError.message("Snyk API base URL is invalid.")
        }
        self.baseURL = url
        self.http = http
    }

    func listOpenIssues() async throws -> [SnykIssueItem] {
        let organizations = try await loadOrganizations()
        var issues: [SnykIssueItem] = []

        for organization in organizations {
            let projectNames = try await loadProjectNames(organizationID: organization.id)
            let records = try await paginate(
                path: "orgs/\(encodedPathComponent(organization.id))/issues",
                query: [
                    "status": "open",
                    "ignored": "false"
                ]
            )
            for record in records {
                issues.append(try issueItem(record, organization: organization, projectNames: projectNames))
            }
        }

        return issues.sorted {
            let leftRank = severityRank($0.severity)
            let rightRank = severityRank($1.severity)
            if leftRank != rightRank {
                return leftRank > rightRank
            }
            if $0.organizationName != $1.organizationName {
                return $0.organizationName < $1.organizationName
            }
            if $0.projectName != $1.projectName {
                return $0.projectName < $1.projectName
            }
            return $0.updatedAt > $1.updatedAt
        }
    }

    private var headers: [String: String] {
        [
            "Authorization": "Token \(token)",
            "Accept": "application/vnd.api+json",
            "User-Agent": "triage-companion",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
        ]
    }

    private func loadOrganizations() async throws -> [SnykOrganization] {
        let records = try await paginate(path: "orgs", query: [:])
        var organizations: [SnykOrganization] = []
        var seen: Set<String> = []

        for record in records {
            let id = try apiPathID(string(record, key: "id", context: "Snyk organization"), label: "Snyk organization ID")
            let attributes = try object(record, key: "attributes", context: "Snyk organization \(id)")
            let slug = try apiPathID(string(attributes, key: "slug", context: "Snyk organization \(id)"), label: "Snyk organization slug")
            let name = try string(attributes, key: "name", context: "Snyk organization \(id)")
            if seen.insert(id).inserted {
                organizations.append(SnykOrganization(id: id, slug: slug, name: name))
            }
        }

        return organizations
    }

    private func loadProjectNames(organizationID: String) async throws -> [String: String] {
        let records = try await paginate(
            path: "orgs/\(encodedPathComponent(organizationID))/projects",
            query: [:]
        )
        var names: [String: String] = [:]
        for record in records {
            let id = try apiPathID(string(record, key: "id", context: "Snyk project"), label: "Snyk project ID")
            let attributes = try object(record, key: "attributes", context: "Snyk project \(id)")
            names[id] = try firstString(attributes, keys: ["name", "target_reference", "origin"], context: "Snyk project \(id)")
        }

        return names
    }

    private func issueItem(
        _ record: [String: Any],
        organization: SnykOrganization,
        projectNames: [String: String]
    ) throws -> SnykIssueItem {
        let issueID = try apiPathID(string(record, key: "id", context: "Snyk issue"), label: "Snyk issue ID")
        let attributes = try object(record, key: "attributes", context: "Snyk issue \(issueID)")
        let projectID = try projectID(from: record, context: "Snyk issue \(issueID)")
        let projectName = projectNames[projectID] ?? "Unavailable project \(projectID)"
        let severity = try string(attributes, key: "effective_severity_level", context: "Snyk issue \(issueID)")
        guard severityRank(severity) > 0 else {
            throw TriageCompanionError.message("Snyk issue \(issueID) included an unknown severity.")
        }
        let status = try string(attributes, key: "status", context: "Snyk issue \(issueID)")
        guard status.lowercased() == "open" else {
            throw TriageCompanionError.message("Snyk issue \(issueID) was not open.")
        }
        if let ignored = attributes["ignored"] as? Bool, ignored {
            throw TriageCompanionError.message("Snyk issue \(issueID) was ignored.")
        }

        let title = try string(attributes, key: "title", context: "Snyk issue \(issueID)")
        let issueType = try string(attributes, key: "type", context: "Snyk issue \(issueID)")
        let issueKey = try string(attributes, key: "key", context: "Snyk issue \(issueID)")
        let updatedAt = try parseServiceDate(
            string(attributes, key: "updated_at", context: "Snyk issue \(issueID)"),
            label: "Snyk issue updated_at"
        )
        guard let url = snykIssueURL(organizationSlug: organization.slug, projectID: projectID, issueKey: issueKey) else {
            throw TriageCompanionError.message("Could not build Snyk issue URL.")
        }

        return SnykIssueItem(
            id: "\(organization.id)#\(issueID)",
            organizationName: organization.name,
            projectName: projectName,
            packageName: packageName(from: attributes),
            severity: severity,
            issueType: issueType,
            title: title,
            updatedAt: updatedAt,
            url: url
        )
    }

    private func paginate(path: String, query: [String: String]) async throws -> [[String: Any]] {
        var queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        queryItems.append(URLQueryItem(name: "version", value: "2024-10-15"))
        queryItems.append(URLQueryItem(name: "limit", value: "100"))

        guard let routeURL = URL(string: "\(baseURL.absoluteString)/\(path)") else {
            throw TriageCompanionError.message("Snyk API route was invalid.")
        }
        var url = urlWithQuery(routeURL, queryItems: queryItems)
        var seen = Set<String>()
        try recordSnykPaginationURL(&seen, url)
        var records: [[String: Any]] = []

        while true {
            let (payload, _) = try await http.jsonObject(
                from: request(url: url, headers: headers),
                serviceName: "Snyk"
            )
            guard let data = payload["data"] as? [[String: Any]] else {
                throw TriageCompanionError.message("Snyk response must include a data array.")
            }
            records.append(contentsOf: data)

            guard let links = payload["links"] as? [String: Any], let next = try paginationHref(from: links["next"]) else {
                break
            }
            let nextURL = try resolvedPaginationURL(next, currentURL: url)
            if data.isEmpty {
                throw TriageCompanionError.message("Snyk response returned an empty page before pagination finished.")
            }
            try recordSnykPaginationURL(&seen, nextURL)
            url = nextURL
        }

        return records
    }

    private func paginationHref(from value: Any?) throws -> String? {
        guard let value else {
            return nil
        }
        if let string = value as? String {
            return try cleanRequiredText(string, label: "Snyk pagination link")
        }
        if let object = value as? [String: Any], let href = object["href"] as? String {
            return try cleanRequiredText(href, label: "Snyk pagination link")
        }

        throw TriageCompanionError.message("Snyk pagination link must be a URL string.")
    }

    private func resolvedPaginationURL(_ value: String, currentURL: URL) throws -> URL {
        guard rawPathSegments(value) != nil else {
            throw TriageCompanionError.message("Snyk pagination link must stay on the current API route.")
        }

        let resolved: URL?
        if value.hasPrefix("/") && !value.hasPrefix("//") {
            resolved = URL(string: "\(baseURL.absoluteString)\(value)")
        } else {
            resolved = URL(string: value, relativeTo: currentURL)?.absoluteURL
        }

        guard let resolved else {
            throw TriageCompanionError.message("Snyk pagination link must be a valid URL.")
        }

        return try validatedPaginationURL(resolved, currentURL: currentURL)
    }

    private func validatedPaginationURL(_ value: URL, currentURL: URL) throws -> URL {
        guard value.user == nil, value.password == nil else {
            throw TriageCompanionError.message("Snyk pagination link must not include credentials.")
        }
        guard value.port == nil else {
            throw TriageCompanionError.message("Snyk pagination link must not include a port.")
        }
        guard value.fragment == nil else {
            throw TriageCompanionError.message("Snyk pagination link must not include fragments.")
        }
        guard isSupportedSnykAPIURL(value) else {
            throw TriageCompanionError.message("Snyk pagination link must stay on a US-hosted REST API base URL.")
        }
        guard sameOrigin(value, currentURL),
              rawPathSegments(value.absoluteString) == rawPathSegments(currentURL.absoluteString) else {
            throw TriageCompanionError.message("Snyk pagination link must stay on the current API route.")
        }

        guard let version = queryValue(value, name: "version") else {
            throw TriageCompanionError.message("Snyk pagination link must include a REST API version.")
        }
        guard version == queryValue(currentURL, name: "version") else {
            throw TriageCompanionError.message("Snyk pagination link must keep the current REST API version.")
        }
        guard stableSnykPaginationQuery(value) == stableSnykPaginationQuery(currentURL) else {
            throw TriageCompanionError.message("Snyk pagination link must keep the current API query.")
        }

        return value
    }

    private func recordSnykPaginationURL(_ seen: inout Set<String>, _ url: URL) throws {
        let key = snykPaginationLoopKey(url)
        guard seen.insert(key).inserted else {
            throw TriageCompanionError.message("Snyk pagination repeated a previously fetched page.")
        }
    }

    private func snykPaginationLoopKey(_ url: URL) -> String {
        normalizedURLString(url, excluding: [])
    }

    private func stableSnykPaginationQuery(_ url: URL) -> String {
        sortedQuery(url, excluding: ["page", "starting_after", "ending_before"])
    }

    private func isSupportedSnykAPIURL(_ url: URL) -> Bool {
        [defaultSnykAPIBaseURL, alternateSnykAPIBaseURL].contains { value in
            guard let allowedURL = URL(string: value), sameOrigin(url, allowedURL) else {
                return false
            }
            let path = url.path
            let allowedPath = allowedURL.path
            return path == allowedPath || path.hasPrefix("\(allowedPath)/")
        }
    }

    private func sameOrigin(_ left: URL, _ right: URL) -> Bool {
        left.scheme?.lowercased() == right.scheme?.lowercased()
            && left.host?.lowercased() == right.host?.lowercased()
            && left.port == right.port
    }

    private func rawPathSegments(_ value: String) -> [String]? {
        let pathAndSuffix: String
        if let schemeRange = value.range(of: "//") {
            let afterAuthority = value[schemeRange.upperBound...]
            if let pathStart = afterAuthority.firstIndex(of: "/") {
                pathAndSuffix = String(afterAuthority[pathStart...])
            } else {
                pathAndSuffix = "/"
            }
        } else if value.hasPrefix("?") || value.hasPrefix("#") || value.isEmpty {
            pathAndSuffix = ""
        } else {
            pathAndSuffix = value
        }

        let pathEnd = pathAndSuffix.indices.first { index in
            pathAndSuffix[index] == "?" || pathAndSuffix[index] == "#"
        } ?? pathAndSuffix.endIndex
        let path = String(pathAndSuffix[..<pathEnd])
        if path.isEmpty {
            return []
        }

        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        let hasLeadingSlash = parts.first == ""
        let hasTrailingSlash = parts.last == ""
        let segments = hasLeadingSlash
            ? (hasTrailingSlash ? parts.dropFirst().dropLast() : parts.dropFirst())
            : (hasTrailingSlash ? parts.dropLast() : parts[...])
        if segments.contains(where: { $0.isEmpty }) {
            return nil
        }

        var decoded: [String] = []
        for segment in segments {
            guard let value = String(segment).removingPercentEncoding, value != ".", value != ".." else {
                return nil
            }
            decoded.append(value)
        }

        return decoded
    }

    private func queryValue(_ url: URL, name: String) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first { $0.name == name }?
            .value
    }

    private func normalizedURLString(_ url: URL, excluding excludedNames: Set<String>) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        let queryItems = components.queryItems?
            .filter { !excludedNames.contains($0.name) }
            .sorted {
                if $0.name == $1.name {
                    return ($0.value ?? "") < ($1.value ?? "")
                }
                return $0.name < $1.name
            }
        components.queryItems = queryItems?.isEmpty == false ? queryItems : nil

        return components.url?.absoluteString ?? url.absoluteString
    }

    private func sortedQuery(_ url: URL, excluding excludedNames: Set<String>) -> String {
        guard let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
            return ""
        }

        return queryItems
            .filter { !excludedNames.contains($0.name) }
            .sorted {
                if $0.name == $1.name {
                    return ($0.value ?? "") < ($1.value ?? "")
                }
                return $0.name < $1.name
            }
            .map { item in
                if let value = item.value {
                    return "\(encodedQueryComponent(item.name))=\(encodedQueryComponent(value))"
                }
                return encodedQueryComponent(item.name)
            }
            .joined(separator: "&")
    }

    private func encodedQueryComponent(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
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

    private func firstString(_ value: [String: Any], keys: [String], context: String) throws -> String {
        for key in keys {
            if let stringValue = value[key] as? String, !stringValue.isEmpty {
                return try cleanRequiredText(stringValue, label: "\(context) \(key)")
            }
        }

        throw TriageCompanionError.message("\(context) must include one of \(keys.joined(separator: ", ")).")
    }

    private func apiPathID(_ value: String, label: String) throws -> String {
        guard value.range(of: #"^[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil, value != ".", value != ".." else {
            throw TriageCompanionError.message("\(label) must be a safe API path segment.")
        }

        return value
    }

    private func projectID(from record: [String: Any], context: String) throws -> String {
        let relationships = try object(record, key: "relationships", context: context)
        let scanItem = try object(relationships, key: "scan_item", context: context)
        let data = try object(scanItem, key: "data", context: context)
        guard let type = data["type"] as? String, type == "project" else {
            throw TriageCompanionError.message("\(context) scan_item relationship must point at a project.")
        }

        return try apiPathID(string(data, key: "id", context: context), label: "Snyk project ID")
    }

    private func packageName(from attributes: [String: Any]) -> String? {
        guard let coordinates = attributes["coordinates"] as? [[String: Any]] else {
            return nil
        }
        for coordinate in coordinates {
            guard let representations = coordinate["representations"] as? [[String: Any]] else {
                continue
            }
            for representation in representations {
                if let package = representation["package"] as? [String: Any],
                   let name = package["name"] as? String,
                   !name.isEmpty {
                    return name
                }
            }
        }

        return nil
    }

    private func snykIssueURL(organizationSlug: String, projectID: String, issueKey: String) -> URL? {
        let appOrigin = baseURL.absoluteString == alternateSnykAPIBaseURL ? "https://app.us.snyk.io" : "https://app.snyk.io"
        return URL(
            string: "\(appOrigin)/org/\(encodedPathComponent(organizationSlug))/project/\(encodedPathComponent(projectID))#issue-\(encodedPathComponent(issueKey))"
        )
    }
}

private struct SnykOrganization {
    let id: String
    let slug: String
    let name: String
}

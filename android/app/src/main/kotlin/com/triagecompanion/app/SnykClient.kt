package com.triagecompanion.app

import java.net.URI
import java.net.URISyntaxException
import org.json.JSONObject

class SnykClient(
    token: String,
    baseURL: String,
    private val http: HttpClient = HttpClient(),
) {
    private val baseURL: String = normalizedSnykAPIBaseURL(baseURL)
    private val headers = mapOf(
        "Authorization" to "Token $token",
        "Accept" to "application/vnd.api+json",
        "User-Agent" to "triage-companion",
        "Cache-Control" to "no-cache",
        "Pragma" to "no-cache",
    )

    private class SnykOrganization(val id: String, val slug: String, val name: String)

    suspend fun listOpenIssues(): List<SnykIssueItem> {
        val organizations = loadOrganizations()
        val issues = mutableListOf<SnykIssueItem>()

        for (organization in organizations) {
            val projectNames = loadProjectNames(organization.id)
            val records = paginate(
                path = "orgs/${encodedPathComponent(organization.id)}/issues",
                query = listOf(
                    "status" to "open",
                    "ignored" to "false",
                ),
            )
            for (record in records) {
                issues.add(issueItem(record, organization, projectNames))
            }
        }

        return issues.sortedWith { left, right ->
            val leftRank = severityRank(left.severity)
            val rightRank = severityRank(right.severity)
            when {
                leftRank != rightRank -> rightRank.compareTo(leftRank)
                left.organizationName != right.organizationName ->
                    left.organizationName.compareTo(right.organizationName)
                left.projectName != right.projectName -> left.projectName.compareTo(right.projectName)
                else -> right.updatedAt.compareTo(left.updatedAt)
            }
        }
    }

    private suspend fun loadOrganizations(): List<SnykOrganization> {
        val records = paginate(path = "orgs", query = emptyList())
        val organizations = mutableListOf<SnykOrganization>()
        val seen = mutableSetOf<String>()

        for (record in records) {
            val id = apiPathID(string(record, "id", context = "Snyk organization"), label = "Snyk organization ID")
            val attributes = obj(record, "attributes", context = "Snyk organization $id")
            val slug = apiPathID(
                string(attributes, "slug", context = "Snyk organization $id"),
                label = "Snyk organization slug",
            )
            val name = string(attributes, "name", context = "Snyk organization $id")
            if (seen.add(id)) {
                organizations.add(SnykOrganization(id, slug, name))
            }
        }

        return organizations
    }

    private suspend fun loadProjectNames(organizationID: String): Map<String, String> {
        val records = paginate(
            path = "orgs/${encodedPathComponent(organizationID)}/projects",
            query = emptyList(),
        )
        val names = mutableMapOf<String, String>()
        for (record in records) {
            val id = apiPathID(string(record, "id", context = "Snyk project"), label = "Snyk project ID")
            val attributes = obj(record, "attributes", context = "Snyk project $id")
            names[id] = firstString(
                attributes,
                keys = listOf("name", "target_reference", "origin"),
                context = "Snyk project $id",
            )
        }

        return names
    }

    private fun issueItem(
        record: JSONObject,
        organization: SnykOrganization,
        projectNames: Map<String, String>,
    ): SnykIssueItem {
        val issueID = apiPathID(string(record, "id", context = "Snyk issue"), label = "Snyk issue ID")
        val attributes = obj(record, "attributes", context = "Snyk issue $issueID")
        val projectID = projectID(record, context = "Snyk issue $issueID")
        val projectName = projectNames[projectID] ?: "Unavailable project $projectID"
        val severity = string(attributes, "effective_severity_level", context = "Snyk issue $issueID")
        if (severityRank(severity) <= 0) {
            throw TriageCompanionException("Snyk issue $issueID included an unknown severity.")
        }
        val status = string(attributes, "status", context = "Snyk issue $issueID")
        if (status.lowercase() != "open") {
            throw TriageCompanionException("Snyk issue $issueID was not open.")
        }
        if (attributes.opt("ignored") == true) {
            throw TriageCompanionException("Snyk issue $issueID was ignored.")
        }

        val title = string(attributes, "title", context = "Snyk issue $issueID")
        val issueType = string(attributes, "type", context = "Snyk issue $issueID")
        val issueKey = string(attributes, "key", context = "Snyk issue $issueID")
        val updatedAt = parseServiceDate(
            string(attributes, "updated_at", context = "Snyk issue $issueID"),
            label = "Snyk issue updated_at",
        )

        return SnykIssueItem(
            id = "${organization.id}#$issueID",
            organizationName = organization.name,
            projectName = projectName,
            packageName = packageName(attributes),
            severity = severity,
            issueType = issueType,
            title = title,
            updatedAt = updatedAt,
            url = snykIssueURL(organization.slug, projectID, issueKey),
        )
    }

    private suspend fun paginate(path: String, query: List<Pair<String, String>>): List<JSONObject> {
        val queryItems = query + listOf(
            "version" to "2024-10-15",
            "limit" to "100",
        )
        var url = urlWithQuery("$baseURL/$path", queryItems)
        val seen = mutableSetOf<String>()
        recordPaginationURL(seen, url)
        val records = mutableListOf<JSONObject>()

        while (true) {
            val (payload, _) = http.jsonObject(url, headers, serviceName = "Snyk")
            val data = payload.optJSONArray("data")
                ?: throw TriageCompanionException("Snyk response must include a data array.")
            for (index in 0 until data.length()) {
                val record = data.opt(index) as? JSONObject
                    ?: throw TriageCompanionException("Snyk response must include a data array.")
                records.add(record)
            }

            val links = payload.optJSONObject("links")
            val next = links?.let { paginationHref(if (it.isNull("next")) null else it.opt("next")) } ?: break
            val nextPageURL = resolvedPaginationURL(next, currentURL = url)
            if (data.length() == 0) {
                throw TriageCompanionException("Snyk response returned an empty page before pagination finished.")
            }
            recordPaginationURL(seen, nextPageURL)
            url = nextPageURL
        }

        return records
    }

    private fun paginationHref(value: Any?): String? {
        if (value == null) {
            return null
        }
        if (value is String) {
            return cleanRequiredText(value, label = "Snyk pagination link")
        }
        if (value is JSONObject) {
            val href = value.opt("href") as? String
            if (href != null) {
                return cleanRequiredText(href, label = "Snyk pagination link")
            }
        }

        throw TriageCompanionException("Snyk pagination link must be a URL string.")
    }

    private fun resolvedPaginationURL(value: String, currentURL: String): String {
        if (rawPathSegments(value) == null) {
            throw TriageCompanionException("Snyk pagination link must stay on the current API route.")
        }

        val resolved: URI? = if (value.startsWith("/") && !value.startsWith("//")) {
            parsedURI("$baseURL$value")
        } else {
            parsedURI(currentURL)?.let { current ->
                try {
                    current.resolve(value)
                } catch (_: IllegalArgumentException) {
                    null
                }
            }
        }
        if (resolved == null) {
            throw TriageCompanionException("Snyk pagination link must be a valid URL.")
        }

        return validatedPaginationURL(resolved, currentURL).toString()
    }

    private fun validatedPaginationURL(value: URI, currentURL: String): URI {
        val current = parsedURI(currentURL)
            ?: throw TriageCompanionException("Snyk pagination link must be a valid URL.")
        if (value.userInfo != null) {
            throw TriageCompanionException("Snyk pagination link must not include credentials.")
        }
        if (value.port != -1) {
            throw TriageCompanionException("Snyk pagination link must not include a port.")
        }
        if (value.rawFragment != null) {
            throw TriageCompanionException("Snyk pagination link must not include fragments.")
        }
        if (!isSupportedSnykAPIURL(value)) {
            throw TriageCompanionException("Snyk pagination link must stay on a US-hosted REST API base URL.")
        }
        if (!sameOrigin(value, current) ||
            rawPathSegments(value.toString()) != rawPathSegments(current.toString())
        ) {
            throw TriageCompanionException("Snyk pagination link must stay on the current API route.")
        }

        val version = queryValue(value, "version")
            ?: throw TriageCompanionException("Snyk pagination link must include a REST API version.")
        if (version != queryValue(current, "version")) {
            throw TriageCompanionException("Snyk pagination link must keep the current REST API version.")
        }
        if (stablePaginationQuery(value) != stablePaginationQuery(current)) {
            throw TriageCompanionException("Snyk pagination link must keep the current API query.")
        }

        return value
    }

    private fun recordPaginationURL(seen: MutableSet<String>, url: String) {
        val parsed = parsedURI(url)
            ?: throw TriageCompanionException("Snyk pagination link must be a valid URL.")
        if (!seen.add(paginationLoopKey(parsed))) {
            throw TriageCompanionException("Snyk pagination repeated a previously fetched page.")
        }
    }

    private fun paginationLoopKey(url: URI): String {
        val query = sortedQueryString(url, excluding = emptySet())
        val base = "${url.scheme}://${url.host}${url.rawPath ?: ""}"
        return if (query.isEmpty()) base else "$base?$query"
    }

    private fun stablePaginationQuery(url: URI): String =
        sortedQueryString(url, excluding = setOf("page", "starting_after", "ending_before"))

    private fun isSupportedSnykAPIURL(url: URI): Boolean =
        listOf(DEFAULT_SNYK_API_BASE_URL, ALTERNATE_SNYK_API_BASE_URL).any { allowed ->
            val allowedURL = parsedURI(allowed) ?: return@any false
            if (!sameOrigin(url, allowedURL)) {
                return@any false
            }
            val path = url.path ?: ""
            val allowedPath = allowedURL.path ?: ""
            path == allowedPath || path.startsWith("$allowedPath/")
        }

    private fun sameOrigin(left: URI, right: URI): Boolean =
        left.scheme?.lowercase() == right.scheme?.lowercase() &&
            left.host?.lowercase() == right.host?.lowercase() &&
            left.port == right.port

    private fun rawPathSegments(value: String): List<String>? {
        val pathAndSuffix: String
        val authorityIndex = value.indexOf("//")
        if (authorityIndex >= 0) {
            val afterAuthority = value.substring(authorityIndex + 2)
            val pathStart = afterAuthority.indexOf('/')
            pathAndSuffix = if (pathStart >= 0) afterAuthority.substring(pathStart) else "/"
        } else if (value.startsWith("?") || value.startsWith("#") || value.isEmpty()) {
            pathAndSuffix = ""
        } else {
            pathAndSuffix = value
        }

        val pathEnd = pathAndSuffix.indexOfFirst { it == '?' || it == '#' }
        val path = if (pathEnd >= 0) pathAndSuffix.substring(0, pathEnd) else pathAndSuffix
        if (path.isEmpty()) {
            return emptyList()
        }

        val parts = path.split("/")
        val hasLeadingSlash = parts.firstOrNull() == ""
        val hasTrailingSlash = parts.size > 1 && parts.last() == ""
        val start = if (hasLeadingSlash) 1 else 0
        val end = if (hasTrailingSlash) parts.size - 1 else parts.size
        val segments = if (start <= end) parts.subList(start, end) else emptyList()
        if (segments.any { it.isEmpty() }) {
            return null
        }

        val decoded = mutableListOf<String>()
        for (segment in segments) {
            val decodedSegment = percentDecoded(segment)
            if (decodedSegment == null || decodedSegment == "." || decodedSegment == "..") {
                return null
            }
            decoded.add(decodedSegment)
        }

        return decoded
    }

    private fun obj(value: JSONObject, key: String, context: String): JSONObject =
        value.optJSONObject(key)
            ?: throw TriageCompanionException("$context must include $key.")

    private fun string(value: JSONObject, key: String, context: String): String {
        val stringValue = value.opt(key) as? String
            ?: throw TriageCompanionException("$context must include $key.")

        return cleanRequiredText(stringValue, label = "$context $key")
    }

    private fun firstString(value: JSONObject, keys: List<String>, context: String): String {
        for (key in keys) {
            val stringValue = value.opt(key) as? String
            if (stringValue != null && stringValue.isNotEmpty()) {
                return cleanRequiredText(stringValue, label = "$context $key")
            }
        }

        throw TriageCompanionException("$context must include one of ${keys.joinToString(", ")}.")
    }

    private fun apiPathID(value: String, label: String): String {
        if (!value.matches(Regex("^[A-Za-z0-9._-]+$")) || value == "." || value == "..") {
            throw TriageCompanionException("$label must be a safe API path segment.")
        }

        return value
    }

    private fun projectID(record: JSONObject, context: String): String {
        val relationships = obj(record, "relationships", context)
        val scanItem = obj(relationships, "scan_item", context)
        val data = obj(scanItem, "data", context)
        if (data.opt("type") as? String != "project") {
            throw TriageCompanionException("$context scan_item relationship must point at a project.")
        }

        return apiPathID(string(data, "id", context), label = "Snyk project ID")
    }

    private fun packageName(attributes: JSONObject): String? {
        val coordinates = attributes.optJSONArray("coordinates") ?: return null
        for (coordinateIndex in 0 until coordinates.length()) {
            val coordinate = coordinates.opt(coordinateIndex) as? JSONObject ?: continue
            val representations = coordinate.optJSONArray("representations") ?: continue
            for (representationIndex in 0 until representations.length()) {
                val representation = representations.opt(representationIndex) as? JSONObject ?: continue
                val name = representation.optJSONObject("package")?.opt("name") as? String
                if (name != null && name.isNotEmpty()) {
                    return name
                }
            }
        }

        return null
    }

    private fun snykIssueURL(organizationSlug: String, projectID: String, issueKey: String): String {
        val appOrigin = if (baseURL == ALTERNATE_SNYK_API_BASE_URL) "https://app.us.snyk.io" else "https://app.snyk.io"
        return "$appOrigin/org/${encodedPathComponent(organizationSlug)}/project/${encodedPathComponent(projectID)}#issue-${encodedPathComponent(issueKey)}"
    }

    private fun parsedURI(value: String): URI? =
        try {
            URI(value)
        } catch (_: URISyntaxException) {
            null
        }
}

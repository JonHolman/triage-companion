package com.triagecompanion.app

import android.util.Base64
import java.net.URI
import java.net.URISyntaxException
import org.json.JSONObject

class JiraClient(
    baseURL: String,
    email: String,
    apiToken: String,
    cloudID: String?,
    private val http: HttpClient = HttpClient(),
) {
    private val settings = JiraSettings(
        baseURL = normalizedJiraBaseURL(baseURL),
        email = cleanRequiredText(email, label = "Jira email"),
        apiToken = cleanRequiredText(apiToken, label = "Jira API token"),
        cloudID = cloudID,
    )

    suspend fun listOpenTickets(): List<JiraTicketItem> {
        val tickets = mutableListOf<JiraTicketItem>()
        var nextPageToken: String? = null
        val seenTokens = mutableSetOf<String>()
        var startAt = 0
        val pageSize = 100

        while (true) {
            val queryItems = mutableListOf(
                "jql" to "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
                "fields" to "summary,status,priority,issuetype,reporter,updated,resolution",
                "maxResults" to pageSize.toString(),
            )
            if (settings.apiKind == JiraAPIKind.DATA_CENTER) {
                queryItems.add("startAt" to startAt.toString())
            } else if (nextPageToken != null) {
                queryItems.add("nextPageToken" to nextPageToken)
            }

            val url = urlWithQuery(settings.routeURL(settings.searchPath), queryItems)
            val (payload, _) = http.jsonObject(url, settings.headers, serviceName = "Jira")
            val issueRecords = payload.optJSONArray("issues")
                ?: throw TriageCompanionException("Jira search response must include an issues array.")
            if (issueRecords.length() > pageSize) {
                throw TriageCompanionException("Jira search response exceeded the requested page size.")
            }
            for (index in 0 until issueRecords.length()) {
                val issue = issueRecords.opt(index) as? JSONObject
                    ?: throw TriageCompanionException("Jira search response must include an issues array.")
                tickets.add(ticketItem(issue))
            }

            if (settings.apiKind == JiraAPIKind.DATA_CENTER) {
                startAt += issueRecords.length()
                val total = payload.opt("total") as? Int
                if (issueRecords.length() == 0 || issueRecords.length() < pageSize ||
                    (total != null && startAt >= total)
                ) {
                    break
                }
            } else {
                val token = payload.opt("nextPageToken") as? String ?: break
                val cleanToken = cleanRequiredText(token, label = "Jira nextPageToken")
                if (issueRecords.length() == 0) {
                    throw TriageCompanionException("Jira search returned an empty page before pagination finished.")
                }
                if (!seenTokens.add(cleanToken)) {
                    throw TriageCompanionException("Jira search pagination repeated a page token.")
                }
                nextPageToken = cleanToken
            }
        }

        return tickets.sortedByDescending { it.updatedAt }
    }

    private fun ticketItem(issue: JSONObject): JiraTicketItem {
        val key = issueKey(string(issue, "key", context = "Jira issue"))
        val fields = obj(issue, "fields", context = "Jira issue $key")
        if (fields.has("resolution") && !fields.isNull("resolution")) {
            throw TriageCompanionException("Jira issue $key was resolved.")
        }

        val issueType = string(obj(fields, "issuetype", "Jira issue $key"), "name", "Jira issue $key type")
        val status = string(obj(fields, "status", "Jira issue $key"), "name", "Jira issue $key status")
        val summary = string(fields, "summary", context = "Jira issue $key")
        val updatedAt = parseServiceDate(
            string(fields, "updated", context = "Jira issue $key"),
            label = "Jira issue updated",
        )
        val priority = fields.optJSONObject("priority")?.let { priorityObject ->
            try {
                string(priorityObject, "name", "Jira issue $key priority")
            } catch (_: TriageCompanionException) {
                null
            }
        }
        val reporter = fields.optJSONObject("reporter")?.let { reporterObject ->
            try {
                string(reporterObject, "displayName", "Jira issue $key reporter")
            } catch (_: TriageCompanionException) {
                try {
                    string(reporterObject, "emailAddress", "Jira issue $key reporter")
                } catch (_: TriageCompanionException) {
                    null
                }
            }
        }

        return JiraTicketItem(
            id = key,
            key = key,
            issueType = issueType,
            status = status,
            priority = priority,
            reporter = reporter,
            updatedAt = updatedAt,
            summary = summary,
            url = "${settings.baseURL}/browse/${encodedPathComponent(key)}",
        )
    }

    private fun obj(value: JSONObject, key: String, context: String): JSONObject =
        value.optJSONObject(key)
            ?: throw TriageCompanionException("$context must include $key.")

    private fun string(value: JSONObject, key: String, context: String): String {
        val stringValue = value.opt(key) as? String
            ?: throw TriageCompanionException("$context must include $key.")

        return cleanRequiredText(stringValue, label = "$context $key")
    }

    private fun issueKey(value: String): String {
        if (!value.matches(Regex("^[A-Za-z][A-Za-z0-9_]*-\\d+$"))) {
            throw TriageCompanionException("Jira issue key must use project-key-number format.")
        }

        return value.uppercase()
    }
}

private enum class JiraAPIKind {
    CLOUD,
    DATA_CENTER,
}

private class JiraSettings(
    val baseURL: String,
    val email: String,
    val apiToken: String,
    val cloudID: String?,
) {
    val apiKind: JiraAPIKind
        get() {
            if (cloudID != null) {
                return JiraAPIKind.CLOUD
            }
            val host = try {
                URI(baseURL).host?.lowercase()
            } catch (_: URISyntaxException) {
                null
            } ?: return JiraAPIKind.CLOUD

            return if (host.endsWith(".atlassian.net")) JiraAPIKind.CLOUD else JiraAPIKind.DATA_CENTER
        }

    val searchPath: String
        get() = if (apiKind == JiraAPIKind.DATA_CENTER) "/rest/api/2/search" else "/rest/api/3/search/jql"

    val headers: Map<String, String>
        get() = mapOf(
            "Authorization" to authorizationHeader,
            "Accept" to "application/json",
            "User-Agent" to "triage-companion",
        )

    private val authorizationHeader: String
        get() {
            if (apiKind == JiraAPIKind.DATA_CENTER) {
                return "Bearer $apiToken"
            }

            val encoded = Base64.encodeToString("$email:$apiToken".toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            return "Basic $encoded"
        }

    fun routeURL(path: String): String {
        val apiBase = if (cloudID != null) {
            "https://api.atlassian.com/ex/jira/${encodedPathComponent(cloudID)}"
        } else {
            baseURL
        }

        return "$apiBase$path"
    }
}

package com.triagecompanion.app

import java.net.URI
import java.net.URISyntaxException
import org.json.JSONObject

class GitHubClient(
    token: String,
    private val http: HttpClient = HttpClient(),
) {
    private val apiBaseURL = "https://api.github.com"
    private val headers = mapOf(
        "Accept" to "application/vnd.github+json",
        "Authorization" to "Bearer $token",
        "X-GitHub-Api-Version" to "2022-11-28",
        "User-Agent" to "triage-companion",
        "Cache-Control" to "no-cache",
        "Pragma" to "no-cache",
    )

    suspend fun listNotifications(
        limit: Int = 50,
        includeRead: Boolean = false,
    ): List<GitHubNotificationItem> =
        fetchNotifications(limit, includeRead)
            .map(::notificationItem)
            .sortedByDescending { it.updatedAt }

    suspend fun markNotificationRead(id: String) {
        if (!id.matches(Regex("^[1-9]\\d*$"))) {
            throw TriageCompanionException("GitHub notification ID must be a positive integer.")
        }

        http.requestWithoutBody(
            "$apiBaseURL/notifications/threads/$id",
            method = "PATCH",
            headers = headers,
            serviceName = "GitHub",
        )
    }

    suspend fun listDependabotAlertsFromNotifications(): List<DependabotAlertItem> =
        listDependabotAlerts(securityAlertRepositories())

    suspend fun listFailedWorkflowRunsFromNotifications(): List<FailedWorkflowRunItem> =
        listFailedWorkflowRuns(notificationRepositories(), maxPerRepository = 5)

    private class NotificationAPI(
        val id: String,
        val repositoryFullName: String,
        val repositoryHTMLURL: String,
        val subjectTitle: String,
        val subjectType: String,
        val subjectURL: String?,
        val reason: String,
        val updatedAt: String,
        val unread: Boolean,
    )

    private suspend fun fetchNotifications(limit: Int, includeRead: Boolean): List<NotificationAPI> {
        val pageSize = maxOf(limit, 1).coerceAtMost(100)
        var url = urlWithQuery(
            "$apiBaseURL/notifications",
            listOf(
                "all" to if (includeRead) "true" else "false",
                "participating" to "false",
                "per_page" to pageSize.toString(),
            ),
        )
        val seen = mutableSetOf<String>()
        recordPaginationURL(seen, url, context = "GitHub notifications pagination")
        val items = mutableListOf<NotificationAPI>()

        while (items.size < limit) {
            val (page, result) = http.jsonArray(url, headers, serviceName = "GitHub notifications")
            for (index in 0 until page.length()) {
                items.add(decodeNotification(page.opt(index)))
            }
            if (items.size >= limit) {
                break
            }
            val next = nextURL(result.linkHeader) ?: break
            val validatedNext = validatedPaginationURL(next, currentURL = url)
            if (page.length() == 0) {
                throw TriageCompanionException("GitHub notifications returned an empty page before pagination finished.")
            }
            recordPaginationURL(seen, validatedNext, context = "GitHub notifications pagination")
            url = validatedNext
        }

        return items.take(limit)
    }

    private fun decodeNotification(value: Any?): NotificationAPI {
        val entry = value as? JSONObject
            ?: throw decodeError("GitHub notifications", "notification entries must be objects")
        val id = when (val idValue = entry.opt("id")) {
            is String -> idValue
            is Int -> idValue.toString()
            is Long -> idValue.toString()
            else -> throw decodeError("GitHub notifications", "id must be a string or integer")
        }
        val repository = entry.optJSONObject("repository")
            ?: throw decodeError("GitHub notifications", "repository must be an object")
        val subject = entry.optJSONObject("subject")
            ?: throw decodeError("GitHub notifications", "subject must be an object")
        val unread = entry.opt("unread") as? Boolean
            ?: throw decodeError("GitHub notifications", "unread must be a boolean")

        return NotificationAPI(
            id = id,
            repositoryFullName = decodedString(repository, "full_name", "GitHub notifications"),
            repositoryHTMLURL = decodedString(repository, "html_url", "GitHub notifications"),
            subjectTitle = decodedString(subject, "title", "GitHub notifications"),
            subjectType = decodedString(subject, "type", "GitHub notifications"),
            subjectURL = if (subject.isNull("url")) null else subject.opt("url") as? String,
            reason = decodedString(entry, "reason", "GitHub notifications"),
            updatedAt = decodedString(entry, "updated_at", "GitHub notifications"),
            unread = unread,
        )
    }

    private fun notificationItem(notification: NotificationAPI): GitHubNotificationItem =
        GitHubNotificationItem(
            id = notification.id,
            repository = notification.repositoryFullName,
            title = notification.subjectTitle,
            reason = notification.reason,
            type = notification.subjectType,
            isUnread = notification.unread,
            updatedAt = parseServiceDate(notification.updatedAt, label = "GitHub notification updated_at"),
            url = webURL(notification),
        )

    private suspend fun securityAlertRepositories(): List<String> =
        fetchNotifications(limit = Int.MAX_VALUE, includeRead = true)
            .filter { it.subjectType == "RepositoryDependabotAlertsThread" || it.reason == "security_alert" }
            .map { it.repositoryFullName }
            .distinct()
            .sorted()

    private suspend fun notificationRepositories(): List<String> =
        fetchNotifications(limit = Int.MAX_VALUE, includeRead = true)
            .map { it.repositoryFullName }
            .distinct()
            .sorted()

    private suspend fun listDependabotAlerts(repositories: List<String>): List<DependabotAlertItem> {
        val alerts = mutableListOf<DependabotAlertItem>()
        for (repository in repositories) {
            val path = repositoryAPIPath(repository)
            var url = urlWithQuery(
                "$apiBaseURL/repos/$path/dependabot/alerts",
                listOf(
                    "state" to "open",
                    "per_page" to "100",
                ),
            )
            val seen = mutableSetOf<String>()
            recordPaginationURL(seen, url, context = "GitHub Dependabot alerts pagination")

            while (true) {
                val (page, result) = http.jsonArray(url, headers, serviceName = "GitHub Dependabot alerts")
                for (index in 0 until page.length()) {
                    alerts.add(dependabotAlertItem(page.opt(index), repository))
                }
                val next = nextURL(result.linkHeader) ?: break
                val validatedNext = validatedPaginationURL(next, currentURL = url)
                if (page.length() == 0) {
                    throw TriageCompanionException("GitHub Dependabot alerts returned an empty page before pagination finished.")
                }
                recordPaginationURL(seen, validatedNext, context = "GitHub Dependabot alerts pagination")
                url = validatedNext
            }
        }

        return alerts.sortedWith { left, right ->
            val leftRank = severityRank(left.severity)
            val rightRank = severityRank(right.severity)
            if (leftRank == rightRank) {
                left.repository.compareTo(right.repository)
            } else {
                rightRank.compareTo(leftRank)
            }
        }
    }

    private fun dependabotAlertItem(value: Any?, repository: String): DependabotAlertItem {
        val alert = value as? JSONObject
            ?: throw decodeError("GitHub Dependabot alerts", "alert entries must be objects")
        val number = alert.opt("number") as? Number
            ?: throw decodeError("GitHub Dependabot alerts", "number must be an integer")
        val state = decodedString(alert, "state", "GitHub Dependabot alerts")
        if (state != "open") {
            throw TriageCompanionException("GitHub Dependabot alert response included a non-open alert.")
        }
        val htmlURL = decodedString(alert, "html_url", "GitHub Dependabot alerts")
        if (!isParsableURL(htmlURL)) {
            throw TriageCompanionException("GitHub Dependabot alert response included an invalid URL.")
        }
        val advisory = alert.optJSONObject("security_advisory")
            ?: throw decodeError("GitHub Dependabot alerts", "security_advisory must be an object")
        val vulnerability = alert.optJSONObject("security_vulnerability")
            ?: throw decodeError("GitHub Dependabot alerts", "security_vulnerability must be an object")

        val packageName = alert.optJSONObject("dependency")?.optJSONObject("package")?.optString("name")
            ?.takeIf { it.isNotEmpty() }
            ?: vulnerability.optJSONObject("package")?.optString("name")?.takeIf { it.isNotEmpty() }
            ?: throw TriageCompanionException("GitHub Dependabot alert response did not include a package name.")
        val severity = optionalString(vulnerability, "severity") ?: optionalString(advisory, "severity")
        if (severity == null || severityRank(severity) <= 0) {
            throw TriageCompanionException("GitHub Dependabot alert response included an unknown severity.")
        }

        return DependabotAlertItem(
            id = "$repository#${number.toLong()}",
            repository = repository,
            packageName = packageName,
            severity = severity,
            summary = decodedString(advisory, "summary", "GitHub Dependabot alerts"),
            patchedVersion = vulnerability.optJSONObject("first_patched_version")
                ?.let { optionalString(it, "identifier") },
            url = htmlURL,
        )
    }

    private suspend fun listFailedWorkflowRuns(
        repositories: List<String>,
        maxPerRepository: Int,
    ): List<FailedWorkflowRunItem> {
        val runs = mutableListOf<FailedWorkflowRunItem>()
        for (repository in repositories) {
            val path = repositoryAPIPath(repository)
            var url = urlWithQuery(
                "$apiBaseURL/repos/$path/actions/runs",
                listOf(
                    "status" to "failure",
                    "per_page" to maxPerRepository.toString(),
                ),
            )
            val repositoryRuns = mutableListOf<FailedWorkflowRunItem>()
            val seen = mutableSetOf<String>()
            recordPaginationURL(seen, url, context = "GitHub workflow runs pagination")

            while (repositoryRuns.size < maxPerRepository) {
                val (payload, result) = http.jsonObject(url, headers, serviceName = "GitHub workflow runs")
                val page = payload.optJSONArray("workflow_runs")
                    ?: throw decodeError("GitHub workflow runs", "workflow_runs must be an array")
                for (index in 0 until page.length()) {
                    repositoryRuns.add(workflowRunItem(page.opt(index), repository))
                }
                if (repositoryRuns.size >= maxPerRepository) {
                    break
                }
                val next = nextURL(result.linkHeader) ?: break
                val validatedNext = validatedPaginationURL(next, currentURL = url)
                if (page.length() == 0) {
                    throw TriageCompanionException("GitHub workflow runs returned an empty page before pagination finished.")
                }
                recordPaginationURL(seen, validatedNext, context = "GitHub workflow runs pagination")
                url = validatedNext
            }
            runs.addAll(repositoryRuns.take(maxPerRepository))
        }

        return runs.sortedByDescending { it.updatedAt }
    }

    private fun workflowRunItem(value: Any?, repository: String): FailedWorkflowRunItem {
        val run = value as? JSONObject
            ?: throw decodeError("GitHub workflow runs", "run entries must be objects")
        val id = run.opt("id") as? Number
            ?: throw decodeError("GitHub workflow runs", "id must be an integer")
        val status = decodedString(run, "status", "GitHub workflow runs")
        val conclusion = decodedString(run, "conclusion", "GitHub workflow runs")
        if (status != "completed" || conclusion != "failure") {
            throw TriageCompanionException("GitHub workflow run response included a non-failed run.")
        }
        val htmlURL = decodedString(run, "html_url", "GitHub workflow runs")
        if (!isParsableURL(htmlURL)) {
            throw TriageCompanionException("GitHub workflow run response included an invalid URL.")
        }

        return FailedWorkflowRunItem(
            id = "$repository#${id.toLong()}",
            repository = repository,
            workflowName = decodedString(run, "name", "GitHub workflow runs"),
            title = decodedString(run, "display_title", "GitHub workflow runs"),
            branch = if (run.isNull("head_branch")) null else run.opt("head_branch") as? String,
            updatedAt = parseServiceDate(
                decodedString(run, "updated_at", "GitHub workflow runs"),
                label = "GitHub workflow run updated_at",
            ),
            url = htmlURL,
        )
    }

    private fun webURL(notification: NotificationAPI): String {
        val subjectURL = notification.subjectURL
        if (subjectURL != null) {
            val apiURL = parsedURI(subjectURL)
            if (apiURL != null && apiURL.host == "api.github.com") {
                val parts = (apiURL.rawPath ?: "")
                    .split("/")
                    .filter { it.isNotEmpty() }
                    .mapNotNull { percentDecoded(it) }
                if (parts.size == 5 && parts[0] == "repos" && parts[3] == "pulls") {
                    return githubWebURL(parts[1], parts[2], kind = "pull", number = parts[4])
                }
                if (parts.size == 5 && parts[0] == "repos" && parts[3] == "issues") {
                    return githubWebURL(parts[1], parts[2], kind = "issues", number = parts[4])
                }
            }
        }

        if (!isParsableURL(notification.repositoryHTMLURL)) {
            throw TriageCompanionException("GitHub notification response included an invalid repository URL.")
        }
        return notification.repositoryHTMLURL
    }

    private fun githubWebURL(owner: String, repository: String, kind: String, number: String): String =
        "https://github.com/${encodedPathComponent(owner)}/${encodedPathComponent(repository)}/$kind/${encodedPathComponent(number)}"

    private fun repositoryAPIPath(fullName: String): String {
        val parts = fullName.split("/")
        if (parts.size != 2 || parts[0].isEmpty() || parts[1].isEmpty()) {
            throw TriageCompanionException("GitHub repository must be in owner/repo form.")
        }

        return "${encodedPathComponent(parts[0])}/${encodedPathComponent(parts[1])}"
    }

    private fun validatedPaginationURL(value: String, currentURL: String): String {
        val url = validatedAPIURL(value)
        val current = validatedAPIURL(currentURL)

        if (rawPathSegments(url) != rawPathSegments(current)) {
            throw TriageCompanionException("GitHub API pagination link must stay on the current API route.")
        }
        if (stablePaginationQuery(url) != stablePaginationQuery(current)) {
            throw TriageCompanionException("GitHub API pagination link must keep the current API query.")
        }

        return url.toString()
    }

    private fun validatedAPIURL(value: String): URI {
        val url = parsedURI(value)
            ?: throw TriageCompanionException("GitHub API pagination link must use https://api.github.com.")
        if (url.scheme?.lowercase() != "https" || url.host?.lowercase() != "api.github.com") {
            throw TriageCompanionException("GitHub API pagination link must use https://api.github.com.")
        }
        if (url.userInfo != null) {
            throw TriageCompanionException("GitHub API pagination link must not include credentials.")
        }
        if (url.port != -1) {
            throw TriageCompanionException("GitHub API pagination link must not include a port.")
        }
        if (url.rawFragment != null) {
            throw TriageCompanionException("GitHub API pagination link must not include fragments.")
        }
        if (rawPathSegments(url) == null) {
            throw TriageCompanionException("GitHub API pagination link must stay on the current API route.")
        }

        return url
    }

    private fun rawPathSegments(url: URI): List<String>? {
        val path = url.rawPath ?: return null
        val parts = path.split("/")
        if (parts.firstOrNull() != "") {
            return null
        }
        val segments = if (parts.size > 1 && parts.last() == "") {
            parts.subList(1, parts.size - 1)
        } else {
            parts.subList(1, parts.size)
        }
        if (segments.any { it.isEmpty() }) {
            return null
        }

        val decoded = mutableListOf<String>()
        for (segment in segments) {
            val value = percentDecoded(segment)
            if (value == null || value == "." || value == "..") {
                return null
            }
            decoded.add(value)
        }

        return decoded
    }

    private fun stablePaginationQuery(url: URI): String =
        sortedQueryString(url, excluding = setOf("page", "after", "before"))

    private fun paginationLoopKey(url: String): String {
        val parsed = validatedAPIURL(url)
        return "${parsed.scheme}://${parsed.host}${parsed.path}?${sortedQueryString(parsed, excluding = emptySet())}"
    }

    private fun recordPaginationURL(seen: MutableSet<String>, url: String, context: String) {
        if (!seen.add(paginationLoopKey(url))) {
            throw TriageCompanionException("$context repeated a previously fetched page.")
        }
    }

    private fun decodedString(value: JSONObject, key: String, serviceName: String): String =
        value.opt(key) as? String ?: throw decodeError(serviceName, "$key must be a string")

    private fun optionalString(value: JSONObject, key: String): String? =
        if (value.isNull(key)) null else value.opt(key) as? String

    private fun decodeError(serviceName: String, detail: String): TriageCompanionException =
        TriageCompanionException("$serviceName response could not be decoded: $detail.")

    private fun isParsableURL(value: String): Boolean = parsedURI(value) != null

    private fun parsedURI(value: String): URI? =
        try {
            URI(value)
        } catch (_: URISyntaxException) {
            null
        }
}

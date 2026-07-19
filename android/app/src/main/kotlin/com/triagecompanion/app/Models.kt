package com.triagecompanion.app

import android.text.format.DateUtils
import java.net.URI
import java.net.URISyntaxException
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

class TriageCompanionException(message: String) : Exception(message)

enum class ServiceId(val serviceName: String) {
    GITHUB("GitHub"),
    SNYK("Snyk"),
    JIRA("Jira"),
}

data class ServiceCredentialStatus(
    val service: ServiceId,
    val isConfigured: Boolean,
    val detail: String,
)

data class GitHubNotificationItem(
    val id: String,
    val repository: String,
    val title: String,
    val reason: String,
    val type: String,
    val isUnread: Boolean,
    val updatedAt: Instant,
    val url: String,
)

data class DependabotAlertItem(
    val id: String,
    val repository: String,
    val packageName: String,
    val severity: String,
    val summary: String,
    val patchedVersion: String?,
    val url: String,
)

data class FailedWorkflowRunItem(
    val id: String,
    val repository: String,
    val workflowName: String,
    val title: String,
    val branch: String?,
    val updatedAt: Instant,
    val url: String,
)

data class SnykIssueItem(
    val id: String,
    val organizationName: String,
    val projectName: String,
    val packageName: String?,
    val severity: String,
    val issueType: String,
    val title: String,
    val updatedAt: Instant,
    val url: String,
)

data class JiraTicketItem(
    val id: String,
    val key: String,
    val issueType: String,
    val status: String,
    val priority: String?,
    val reporter: String?,
    val updatedAt: Instant,
    val summary: String,
    val url: String,
)

data class CredentialSnapshot(
    val githubToken: String?,
    val snykToken: String?,
    val snykAPIBaseURL: String,
    val jiraBaseURL: String?,
    val jiraEmail: String?,
    val jiraAPIToken: String?,
    val jiraCloudID: String?,
) {
    val hasGitHub: Boolean get() = githubToken != null
    val hasSnyk: Boolean get() = snykToken != null
    val hasJira: Boolean get() = jiraBaseURL != null && jiraEmail != null && jiraAPIToken != null
}

sealed interface LoadState<out T> {
    data object Idle : LoadState<Nothing>
    data object Loading : LoadState<Nothing>
    data class NotConfigured(val message: String) : LoadState<Nothing>
    data class Loaded<T>(val value: T, val checkedAt: Instant) : LoadState<T>
    data class Failed(val message: String) : LoadState<Nothing>

    val errorText: String?
        get() = when (this) {
            is Failed -> message
            is NotConfigured -> message
            else -> null
        }
}

const val DEFAULT_SNYK_API_BASE_URL = "https://api.snyk.io/rest"
const val ALTERNATE_SNYK_API_BASE_URL = "https://api.us.snyk.io/rest"

fun cleanRequiredText(value: String, label: String): String {
    if (value.trim() != value) {
        throw TriageCompanionException("$label must not include surrounding whitespace.")
    }
    if (value.isEmpty()) {
        throw TriageCompanionException("$label is required.")
    }
    if (value.any { it.isISOControl() }) {
        throw TriageCompanionException("$label must not include control characters.")
    }

    return value
}

fun optionalCleanText(value: String, label: String): String? {
    if (value.isEmpty()) {
        return null
    }

    return cleanRequiredText(value, label)
}

private fun parsedURI(value: String): URI? =
    try {
        URI(value)
    } catch (_: URISyntaxException) {
        null
    }

fun normalizedSnykAPIBaseURL(value: String): String {
    val text = cleanRequiredText(value, label = "Snyk API base URL")
    val uri = parsedURI(text)
    if (uri == null || uri.scheme != "https" || uri.userInfo != null || uri.port != -1) {
        throw TriageCompanionException("Snyk API base URL must be a valid https URL without credentials or a port.")
    }

    val normalized = uri.toString().removeSuffix("/")
    if (normalized != DEFAULT_SNYK_API_BASE_URL && normalized != ALTERNATE_SNYK_API_BASE_URL) {
        throw TriageCompanionException(
            "Snyk API base URL must be $DEFAULT_SNYK_API_BASE_URL or $ALTERNATE_SNYK_API_BASE_URL.",
        )
    }

    return normalized
}

fun normalizedJiraBaseURL(value: String): String {
    val text = cleanRequiredText(value, label = "Jira base URL")
    val valueWithScheme = if (text.contains("://")) text else "https://$text"
    val uri = parsedURI(valueWithScheme)
    if (uri == null || uri.scheme != "https" || uri.userInfo != null || uri.port != -1 || uri.host == null) {
        throw TriageCompanionException("Jira base URL must be a valid https URL without credentials or a port.")
    }
    val path = uri.rawPath ?: ""
    if ((path.isNotEmpty() && path != "/") || uri.rawQuery != null || uri.rawFragment != null) {
        throw TriageCompanionException("Jira base URL must be the site root.")
    }

    return "${uri.scheme}://${uri.host}"
}

fun validateCloudID(value: String): String? {
    val text = optionalCleanText(value, label = "Jira Cloud ID") ?: return null
    if (!text.matches(Regex("^[A-Za-z0-9._:-]+$"))) {
        throw TriageCompanionException("Jira Cloud ID contains unsupported characters.")
    }

    return text
}

fun parseServiceDate(value: String, label: String): Instant {
    try {
        return OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant()
    } catch (_: DateTimeParseException) {
        throw TriageCompanionException("$label must be an ISO-8601 timestamp.")
    }
}

fun severityRank(severity: String): Int =
    when (severity.lowercase()) {
        "critical" -> 4
        "high" -> 3
        "medium" -> 2
        "low" -> 1
        else -> 0
    }

fun relativeTime(instant: Instant): String =
    DateUtils.getRelativeTimeSpanString(
        instant.toEpochMilli(),
        System.currentTimeMillis(),
        DateUtils.MINUTE_IN_MILLIS,
        DateUtils.FORMAT_ABBREV_RELATIVE,
    ).toString()

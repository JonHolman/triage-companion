package com.triagecompanion.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.time.Instant
import kotlinx.coroutines.launch

class CredentialDraft {
    var githubToken by mutableStateOf("")
    var snykToken by mutableStateOf("")
    var snykAPIBaseURL by mutableStateOf(DEFAULT_SNYK_API_BASE_URL)
    var jiraBaseURL by mutableStateOf("")
    var jiraEmail by mutableStateOf("")
    var jiraAPIToken by mutableStateOf("")
    var jiraCloudID by mutableStateOf("")
}

class AppModel(application: Application) : AndroidViewModel(application) {
    private val store: CredentialStoring = AppCredentialStore(application)

    val draft = CredentialDraft()
    var credentialStatuses by mutableStateOf(listOf<ServiceCredentialStatus>())
        private set
    var settingsMessage by mutableStateOf<String?>(null)
        private set
    var isSavingSettings by mutableStateOf(false)
        private set

    var notifications by mutableStateOf<LoadState<List<GitHubNotificationItem>>>(LoadState.Idle)
        private set
    var dependabotAlerts by mutableStateOf<LoadState<List<DependabotAlertItem>>>(LoadState.Idle)
        private set
    var failedWorkflows by mutableStateOf<LoadState<List<FailedWorkflowRunItem>>>(LoadState.Idle)
        private set
    var snykIssues by mutableStateOf<LoadState<List<SnykIssueItem>>>(LoadState.Idle)
        private set
    var jiraTickets by mutableStateOf<LoadState<List<JiraTicketItem>>>(LoadState.Idle)
        private set

    var hasSavedGitHubToken by mutableStateOf(false)
        private set
    var hasSavedSnykToken by mutableStateOf(false)
        private set
    var hasSavedJiraToken by mutableStateOf(false)
        private set

    init {
        reloadCredentials()
    }

    fun reloadCredentials() {
        try {
            val snapshot = credentialSnapshot()
            hasSavedGitHubToken = snapshot.githubToken != null
            hasSavedSnykToken = snapshot.snykToken != null
            hasSavedJiraToken = snapshot.jiraAPIToken != null
            draft.githubToken = ""
            draft.snykToken = ""
            draft.jiraAPIToken = ""
            draft.snykAPIBaseURL = snapshot.snykAPIBaseURL
            draft.jiraBaseURL = snapshot.jiraBaseURL ?: ""
            draft.jiraEmail = snapshot.jiraEmail ?: ""
            draft.jiraCloudID = snapshot.jiraCloudID ?: ""
            credentialStatuses = listOf(
                ServiceCredentialStatus(
                    service = ServiceId.GITHUB,
                    isConfigured = snapshot.hasGitHub,
                    detail = if (snapshot.hasGitHub) "Token saved" else "Token required",
                ),
                ServiceCredentialStatus(
                    service = ServiceId.SNYK,
                    isConfigured = snapshot.hasSnyk,
                    detail = if (snapshot.hasSnyk) "Token saved" else "Token required",
                ),
                ServiceCredentialStatus(
                    service = ServiceId.JIRA,
                    isConfigured = snapshot.hasJira,
                    detail = if (snapshot.hasJira) "Credentials saved" else "Base URL, email, and token required",
                ),
            )
        } catch (error: Exception) {
            settingsMessage = errorMessage(error)
        }
    }

    fun saveSettings() {
        viewModelScope.launch {
            isSavingSettings = true
            try {
                if (draft.githubToken.isNotEmpty()) {
                    store.save(cleanRequiredText(draft.githubToken, label = "GitHub token"), CredentialKey.GITHUB_TOKEN)
                }
                if (draft.snykToken.isNotEmpty()) {
                    store.save(cleanRequiredText(draft.snykToken, label = "Snyk token"), CredentialKey.SNYK_TOKEN)
                }
                store.save(normalizedSnykAPIBaseURL(draft.snykAPIBaseURL), CredentialKey.SNYK_API_BASE_URL)

                val hasJiraInput = draft.jiraBaseURL.isNotEmpty() || draft.jiraEmail.isNotEmpty() ||
                    draft.jiraAPIToken.isNotEmpty() || draft.jiraCloudID.isNotEmpty()
                if (hasJiraInput) {
                    store.save(normalizedJiraBaseURL(draft.jiraBaseURL), CredentialKey.JIRA_BASE_URL)
                    store.save(cleanRequiredText(draft.jiraEmail, label = "Jira email"), CredentialKey.JIRA_EMAIL)
                    if (draft.jiraAPIToken.isNotEmpty()) {
                        store.save(
                            cleanRequiredText(draft.jiraAPIToken, label = "Jira API token"),
                            CredentialKey.JIRA_API_TOKEN,
                        )
                    } else if (store.read(CredentialKey.JIRA_API_TOKEN) == null) {
                        throw TriageCompanionException("Jira API token is required.")
                    }
                    store.save(validateCloudID(draft.jiraCloudID), CredentialKey.JIRA_CLOUD_ID)
                }

                settingsMessage = "Settings saved."
                reloadCredentials()
            } catch (error: Exception) {
                settingsMessage = errorMessage(error)
            } finally {
                isSavingSettings = false
            }
        }
    }

    fun removeGitHubToken() {
        try {
            store.save(null, CredentialKey.GITHUB_TOKEN)
            settingsMessage = "GitHub token removed."
            reloadCredentials()
        } catch (error: Exception) {
            settingsMessage = errorMessage(error)
        }
    }

    fun removeSnykToken() {
        try {
            store.save(null, CredentialKey.SNYK_TOKEN)
            settingsMessage = "Snyk token removed."
            reloadCredentials()
        } catch (error: Exception) {
            settingsMessage = errorMessage(error)
        }
    }

    fun clearJiraCredentials() {
        try {
            store.save(null, CredentialKey.JIRA_BASE_URL)
            store.save(null, CredentialKey.JIRA_EMAIL)
            store.save(null, CredentialKey.JIRA_API_TOKEN)
            store.save(null, CredentialKey.JIRA_CLOUD_ID)
            settingsMessage = "Jira credentials cleared."
            reloadCredentials()
        } catch (error: Exception) {
            settingsMessage = errorMessage(error)
        }
    }

    fun refreshAll() {
        viewModelScope.launch {
            refreshGitHubNow()
            refreshSnykNow()
            refreshJiraNow()
        }
    }

    fun refreshGitHub() {
        viewModelScope.launch { refreshGitHubNow() }
    }

    fun refreshSnyk() {
        viewModelScope.launch { refreshSnykNow() }
    }

    fun refreshJira() {
        viewModelScope.launch { refreshJiraNow() }
    }

    private suspend fun refreshGitHubNow() {
        val snapshot = try {
            credentialSnapshot()
        } catch (error: Exception) {
            val message = errorMessage(error)
            notifications = LoadState.Failed(message)
            dependabotAlerts = LoadState.Failed(message)
            failedWorkflows = LoadState.Failed(message)
            return
        }

        val token = snapshot.githubToken
        if (token == null) {
            val message = "Save a GitHub token in Settings."
            notifications = LoadState.NotConfigured(message)
            dependabotAlerts = LoadState.NotConfigured(message)
            failedWorkflows = LoadState.NotConfigured(message)
            return
        }

        val client = GitHubClient(token)
        notifications = LoadState.Loading
        dependabotAlerts = LoadState.Loading
        failedWorkflows = LoadState.Loading
        try {
            notifications = LoadState.Loaded(client.listNotifications(), Instant.now())
            dependabotAlerts = LoadState.Loaded(client.listDependabotAlertsFromNotifications(), Instant.now())
            failedWorkflows = LoadState.Loaded(client.listFailedWorkflowRunsFromNotifications(), Instant.now())
        } catch (error: Exception) {
            val message = errorMessage(error)
            if (notifications == LoadState.Loading) {
                notifications = LoadState.Failed(message)
            }
            if (dependabotAlerts == LoadState.Loading) {
                dependabotAlerts = LoadState.Failed(message)
            }
            if (failedWorkflows == LoadState.Loading) {
                failedWorkflows = LoadState.Failed(message)
            }
        }
    }

    private suspend fun refreshSnykNow() {
        val snapshot = try {
            credentialSnapshot()
        } catch (error: Exception) {
            snykIssues = LoadState.Failed(errorMessage(error))
            return
        }

        val token = snapshot.snykToken
        if (token == null) {
            snykIssues = LoadState.NotConfigured("Save a Snyk token in Settings.")
            return
        }

        snykIssues = LoadState.Loading
        try {
            val client = SnykClient(token, baseURL = snapshot.snykAPIBaseURL)
            snykIssues = LoadState.Loaded(client.listOpenIssues(), Instant.now())
        } catch (error: Exception) {
            snykIssues = LoadState.Failed(errorMessage(error))
        }
    }

    private suspend fun refreshJiraNow() {
        val snapshot = try {
            credentialSnapshot()
        } catch (error: Exception) {
            jiraTickets = LoadState.Failed(errorMessage(error))
            return
        }

        val baseURL = snapshot.jiraBaseURL
        val email = snapshot.jiraEmail
        val apiToken = snapshot.jiraAPIToken
        if (baseURL == null || email == null || apiToken == null) {
            jiraTickets = LoadState.NotConfigured("Save Jira credentials in Settings.")
            return
        }

        jiraTickets = LoadState.Loading
        try {
            val client = JiraClient(baseURL, email, apiToken, cloudID = snapshot.jiraCloudID)
            jiraTickets = LoadState.Loaded(client.listOpenTickets(), Instant.now())
        } catch (error: Exception) {
            jiraTickets = LoadState.Failed(errorMessage(error))
        }
    }

    private fun credentialSnapshot(): CredentialSnapshot {
        val snykAPIBaseURL = normalizedSnykAPIBaseURL(
            store.read(CredentialKey.SNYK_API_BASE_URL) ?: DEFAULT_SNYK_API_BASE_URL,
        )
        val cloudID = validateCloudID(store.read(CredentialKey.JIRA_CLOUD_ID) ?: "")

        return CredentialSnapshot(
            githubToken = storedRequiredText(CredentialKey.GITHUB_TOKEN, label = "GitHub token"),
            snykToken = storedRequiredText(CredentialKey.SNYK_TOKEN, label = "Snyk token"),
            snykAPIBaseURL = snykAPIBaseURL,
            jiraBaseURL = storedNormalizedJiraBaseURL(),
            jiraEmail = storedRequiredText(CredentialKey.JIRA_EMAIL, label = "Jira email"),
            jiraAPIToken = storedRequiredText(CredentialKey.JIRA_API_TOKEN, label = "Jira API token"),
            jiraCloudID = cloudID,
        )
    }

    private fun storedRequiredText(key: CredentialKey, label: String): String? {
        val value = store.read(key) ?: return null

        return cleanRequiredText(value, label)
    }

    private fun storedNormalizedJiraBaseURL(): String? {
        val value = store.read(CredentialKey.JIRA_BASE_URL) ?: return null

        return normalizedJiraBaseURL(value)
    }

    private fun errorMessage(error: Exception): String =
        error.message ?: error.javaClass.simpleName
}

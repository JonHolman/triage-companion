package com.triagecompanion.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

enum class AppRoute(val title: String, val icon: ImageVector) {
    DASHBOARD("Dashboard", Icons.Filled.Home),
    GITHUB("GitHub", Icons.Filled.Notifications),
    SNYK("Snyk", Icons.Filled.Warning),
    JIRA("Jira", Icons.AutoMirrored.Filled.List),
    SETTINGS("Settings", Icons.Filled.Settings),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContentView(model: AppModel) {
    var selection by rememberSaveable { mutableStateOf(AppRoute.DASHBOARD) }
    var didLoad by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (!didLoad) {
            didLoad = true
            model.refreshAll()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(selection.title) },
                actions = {
                    IconButton(onClick = {
                        when (selection) {
                            AppRoute.GITHUB -> model.refreshGitHub()
                            AppRoute.SNYK -> model.refreshSnyk()
                            AppRoute.JIRA -> model.refreshJira()
                            else -> model.refreshAll()
                        }
                    }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                for (route in AppRoute.entries) {
                    NavigationBarItem(
                        selected = selection == route,
                        onClick = { selection = route },
                        icon = { Icon(route.icon, contentDescription = route.title) },
                        label = { Text(route.title) },
                    )
                }
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (selection) {
                AppRoute.DASHBOARD -> DashboardView(model)
                AppRoute.GITHUB -> GitHubView(model)
                AppRoute.SNYK -> SnykView(model)
                AppRoute.JIRA -> JiraView(model)
                AppRoute.SETTINGS -> SettingsView(model)
            }
        }
    }
}

@Composable
fun DashboardView(model: AppModel) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { SectionHeader("Services") }
        items(model.credentialStatuses.size) { index ->
            val status = model.credentialStatuses[index]
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    routeIcon(status.service),
                    contentDescription = null,
                    tint = if (status.isConfigured) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
                Column(modifier = Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(status.service.serviceName, style = MaterialTheme.typography.titleMedium)
                    Text(
                        status.detail,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(
                    if (status.isConfigured) Icons.Filled.CheckCircle else Icons.Filled.Warning,
                    contentDescription = null,
                    tint = if (status.isConfigured) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                )
            }
        }

        item { SectionHeader("Activity") }
        item { MetricRow("GitHub notifications", model.notifications) }
        item { MetricRow("Dependabot alerts", model.dependabotAlerts) }
        item { MetricRow("Failed workflows", model.failedWorkflows) }
        item { MetricRow("Snyk issues", model.snykIssues) }
        item { MetricRow("Jira tickets", model.jiraTickets) }
    }
}

private fun routeIcon(service: ServiceId): ImageVector =
    when (service) {
        ServiceId.GITHUB -> Icons.Filled.Notifications
        ServiceId.SNYK -> Icons.Filled.Warning
        ServiceId.JIRA -> Icons.AutoMirrored.Filled.List
    }

@Composable
fun <T> MetricRow(title: String, state: LoadState<List<T>>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(
                metricDetailText(state),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        when (state) {
            is LoadState.Loaded -> Text(
                state.value.size.toString(),
                style = MaterialTheme.typography.titleLarge,
            )
            LoadState.Loading -> CircularProgressIndicator(modifier = Modifier.size(22.dp))
            else -> Unit
        }
    }
}

private fun <T> metricDetailText(state: LoadState<List<T>>): String =
    when (state) {
        LoadState.Idle -> "Not checked"
        LoadState.Loading -> "Checking"
        is LoadState.NotConfigured -> state.message
        is LoadState.Loaded -> "Checked ${relativeTime(state.checkedAt)}"
        is LoadState.Failed -> state.message
    }

@Composable
fun GitHubView(model: AppModel) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { SectionHeader("Notifications") }
        stateRows(model.notifications, emptyText = "No notifications") { item ->
            LinkRow(
                title = item.title,
                subtitle = "${item.repository} - ${item.type} - ${item.reason}",
                trailing = relativeTime(item.updatedAt),
                url = item.url,
            )
        }
        item { SectionHeader("Dependabot Alerts") }
        stateRows(model.dependabotAlerts, emptyText = "No open alerts") { item ->
            LinkRow(
                title = item.summary,
                subtitle = "${item.repository} - ${item.packageName} - ${item.severity.uppercase()}",
                trailing = item.patchedVersion ?: "no patch",
                url = item.url,
            )
        }
        item { SectionHeader("Failed Workflows") }
        stateRows(model.failedWorkflows, emptyText = "No failed runs") { item ->
            LinkRow(
                title = item.title,
                subtitle = "${item.repository} - ${item.workflowName}${item.branch?.let { " - $it" } ?: ""}",
                trailing = relativeTime(item.updatedAt),
                url = item.url,
            )
        }
    }
}

@Composable
fun SnykView(model: AppModel) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { SectionHeader("Open Issues") }
        stateRows(model.snykIssues, emptyText = "No open issues") { item ->
            LinkRow(
                title = item.title,
                subtitle = "${item.organizationName} - ${item.projectName} - ${item.severity.uppercase()}",
                trailing = item.packageName ?: item.issueType,
                url = item.url,
            )
        }
    }
}

@Composable
fun JiraView(model: AppModel) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { SectionHeader("Assigned Tickets") }
        stateRows(model.jiraTickets, emptyText = "No assigned tickets") { item ->
            LinkRow(
                title = item.summary,
                subtitle = "${item.key} - ${item.issueType} - ${item.status}",
                trailing = relativeTime(item.updatedAt),
                url = item.url,
            )
        }
    }
}

private fun <T> LazyListScope.stateRows(
    state: LoadState<List<T>>,
    emptyText: String,
    row: @Composable (T) -> Unit,
) {
    when (state) {
        LoadState.Idle -> item { StatusRow("Not checked", Icons.Filled.DateRange) }
        LoadState.Loading -> item { LoadingRow() }
        is LoadState.NotConfigured -> item { StatusRow(state.message, Icons.Filled.Warning) }
        is LoadState.Failed -> item { StatusRow(state.message, Icons.Filled.Warning) }
        is LoadState.Loaded -> {
            if (state.value.isEmpty()) {
                item { StatusRow(emptyText, Icons.Filled.CheckCircle) }
            } else {
                items(state.value.size) { index -> row(state.value[index]) }
            }
        }
    }
}

@Composable
fun SettingsView(model: AppModel) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("GitHub", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = model.draft.githubToken,
            onValueChange = { model.draft.githubToken = it },
            label = { Text("New token") },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        SavedCredentialRow(
            text = if (model.hasSavedGitHubToken) "Token saved" else "Token not saved",
            isSaved = model.hasSavedGitHubToken,
            removeLabel = "Remove",
            removeEnabled = model.hasSavedGitHubToken,
            onRemove = { model.removeGitHubToken() },
        )

        Text("Snyk", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = model.draft.snykToken,
            onValueChange = { model.draft.snykToken = it },
            label = { Text("New token") },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        Text("API base URL", style = MaterialTheme.typography.bodyMedium)
        for (baseURL in listOf(DEFAULT_SNYK_API_BASE_URL, ALTERNATE_SNYK_API_BASE_URL)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .selectable(
                        selected = model.draft.snykAPIBaseURL == baseURL,
                        onClick = { model.draft.snykAPIBaseURL = baseURL },
                    ),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(
                    selected = model.draft.snykAPIBaseURL == baseURL,
                    onClick = { model.draft.snykAPIBaseURL = baseURL },
                )
                Text(baseURL, style = MaterialTheme.typography.bodyMedium)
            }
        }
        SavedCredentialRow(
            text = if (model.hasSavedSnykToken) "Token saved" else "Token not saved",
            isSaved = model.hasSavedSnykToken,
            removeLabel = "Remove",
            removeEnabled = model.hasSavedSnykToken,
            onRemove = { model.removeSnykToken() },
        )

        Text("Jira", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = model.draft.jiraBaseURL,
            onValueChange = { model.draft.jiraBaseURL = it },
            label = { Text("Base URL") },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = model.draft.jiraEmail,
            onValueChange = { model.draft.jiraEmail = it },
            label = { Text("Email") },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = model.draft.jiraAPIToken,
            onValueChange = { model.draft.jiraAPIToken = it },
            label = { Text("New API token") },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = model.draft.jiraCloudID,
            onValueChange = { model.draft.jiraCloudID = it },
            label = { Text("Cloud ID") },
            modifier = Modifier.fillMaxWidth(),
        )
        SavedCredentialRow(
            text = if (model.hasSavedJiraToken) "API token saved" else "API token not saved",
            isSaved = model.hasSavedJiraToken,
            removeLabel = "Clear",
            removeEnabled = true,
            onRemove = { model.clearJiraCredentials() },
        )

        Button(
            onClick = { model.saveSettings() },
            enabled = !model.isSavingSettings,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (model.isSavingSettings) "Saving" else "Save Settings")
        }

        model.settingsMessage?.let { message ->
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SavedCredentialRow(
    text: String,
    isSaved: Boolean,
    removeLabel: String,
    removeEnabled: Boolean,
    onRemove: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (isSaved) Icons.Filled.CheckCircle else Icons.Filled.Lock,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
        )
        OutlinedButton(onClick = onRemove, enabled = removeEnabled) {
            Icon(Icons.Filled.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(4.dp))
            Text(removeLabel)
        }
    }
}

@Composable
fun LinkRow(title: String, subtitle: String, trailing: String, url: String) {
    val context = LocalContext.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
            )
        }
        Text(
            trailing,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

@Composable
fun LoadingRow() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(modifier = Modifier.size(22.dp))
        Text(
            "Checking",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

@Composable
fun StatusRow(text: String, icon: ImageVector) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

@Composable
fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 4.dp),
    )
}

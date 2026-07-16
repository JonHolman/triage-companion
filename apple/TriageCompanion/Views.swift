import SwiftUI

enum AppRoute: String, CaseIterable, Identifiable, Hashable {
    case dashboard
    case github
    case snyk
    case jira
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard:
            return "Dashboard"
        case .github:
            return "GitHub"
        case .snyk:
            return "Snyk"
        case .jira:
            return "Jira"
        case .settings:
            return "Settings"
        }
    }

    var symbolName: String {
        switch self {
        case .dashboard:
            return "rectangle.grid.2x2"
        case .github:
            return "bell.badge"
        case .snyk:
            return "shield.lefthalf.filled"
        case .jira:
            return "checklist"
        case .settings:
            return "gearshape"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selection: AppRoute? = .dashboard
    @State private var didLoad = false

    var body: some View {
        NavigationSplitView {
            List(AppRoute.allCases, selection: $selection) { route in
                Label(route.title, systemImage: route.symbolName)
                    .tag(route)
            }
            .navigationTitle("Triage")
        } detail: {
            Group {
                switch selection ?? .dashboard {
                case .dashboard:
                    DashboardView()
                case .github:
                    GitHubView()
                case .snyk:
                    SnykView()
                case .jira:
                    JiraView()
                case .settings:
                    SettingsView()
                }
            }
            .toolbar {
                ToolbarItem {
                    Button {
                        Task { await model.refreshAll() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
            }
        }
        .task {
            guard !didLoad else {
                return
            }
            didLoad = true
            await model.refreshAll()
        }
    }
}

struct DashboardView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List {
            Section("Services") {
                ForEach(model.credentialStatuses) { status in
                    HStack(spacing: 12) {
                        Image(systemName: status.service.symbolName)
                            .foregroundStyle(status.isConfigured ? .green : .secondary)
                            .frame(width: 26)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(status.service.name)
                                .font(.headline)
                            Text(status.detail)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: status.isConfigured ? "checkmark.circle.fill" : "exclamationmark.circle")
                            .foregroundStyle(status.isConfigured ? .green : .orange)
                    }
                    .padding(.vertical, 4)
                }
            }

            Section("Activity") {
                MetricRow(title: "GitHub notifications", symbolName: "bell", state: model.notifications)
                MetricRow(title: "Dependabot alerts", symbolName: "shield", state: model.dependabotAlerts)
                MetricRow(title: "Failed workflows", symbolName: "xmark.octagon", state: model.failedWorkflows)
                MetricRow(title: "Snyk issues", symbolName: "exclamationmark.triangle", state: model.snykIssues)
                MetricRow(title: "Jira tickets", symbolName: "checklist", state: model.jiraTickets)
            }
        }
        .navigationTitle("Dashboard")
    }
}

struct MetricRow<Value>: View {
    let title: String
    let symbolName: String
    let state: LoadState<[Value]>

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbolName)
                .foregroundStyle(Color.accentColor)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                Text(detailText)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if case let .loaded(items, _) = state {
                Text(String(items.count))
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(.primary)
            } else if case .loading = state {
                ProgressView()
            }
        }
        .padding(.vertical, 4)
    }

    private var detailText: String {
        switch state {
        case .idle:
            return "Not checked"
        case .loading:
            return "Checking"
        case let .notConfigured(message):
            return message
        case let .loaded(_, checkedAt):
            return "Checked \(relativeTime(checkedAt))"
        case let .failed(message):
            return message
        }
    }
}

struct GitHubView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List {
            Section("Notifications") {
                notificationRows(model.notifications)
            }
            Section("Dependabot Alerts") {
                dependabotRows(model.dependabotAlerts)
            }
            Section("Failed Workflows") {
                workflowRows(model.failedWorkflows)
            }
        }
        .navigationTitle("GitHub")
        .toolbar {
            ToolbarItem {
                Button {
                    Task { await model.refreshGitHub() }
                } label: {
                    Label("Refresh GitHub", systemImage: "arrow.clockwise")
                }
            }
        }
    }

    @ViewBuilder
    private func notificationRows(_ state: LoadState<[GitHubNotificationItem]>) -> some View {
        switch state {
        case .idle:
            StatusRow(text: "Not checked", symbolName: "clock")
        case .loading:
            LoadingRow()
        case let .notConfigured(message), let .failed(message):
            StatusRow(text: message, symbolName: "exclamationmark.triangle")
        case let .loaded(items, _):
            if items.isEmpty {
                StatusRow(text: "No notifications", symbolName: "checkmark.circle")
            } else {
                ForEach(items) { item in
                    GitHubNotificationRow(item: item)
                }
            }
        }
    }

    @ViewBuilder
    private func dependabotRows(_ state: LoadState<[DependabotAlertItem]>) -> some View {
        switch state {
        case .idle:
            StatusRow(text: "Not checked", symbolName: "clock")
        case .loading:
            LoadingRow()
        case let .notConfigured(message), let .failed(message):
            StatusRow(text: message, symbolName: "exclamationmark.triangle")
        case let .loaded(items, _):
            if items.isEmpty {
                StatusRow(text: "No open alerts", symbolName: "checkmark.circle")
            } else {
                ForEach(items) { item in
                    DependabotAlertRow(item: item)
                }
            }
        }
    }

    @ViewBuilder
    private func workflowRows(_ state: LoadState<[FailedWorkflowRunItem]>) -> some View {
        switch state {
        case .idle:
            StatusRow(text: "Not checked", symbolName: "clock")
        case .loading:
            LoadingRow()
        case let .notConfigured(message), let .failed(message):
            StatusRow(text: message, symbolName: "exclamationmark.triangle")
        case let .loaded(items, _):
            if items.isEmpty {
                StatusRow(text: "No failed runs", symbolName: "checkmark.circle")
            } else {
                ForEach(items) { item in
                    WorkflowRunRow(item: item)
                }
            }
        }
    }
}

struct SnykView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List {
            Section("Open Issues") {
                switch model.snykIssues {
                case .idle:
                    StatusRow(text: "Not checked", symbolName: "clock")
                case .loading:
                    LoadingRow()
                case let .notConfigured(message), let .failed(message):
                    StatusRow(text: message, symbolName: "exclamationmark.triangle")
                case let .loaded(items, _):
                    if items.isEmpty {
                        StatusRow(text: "No open issues", symbolName: "checkmark.circle")
                    } else {
                        ForEach(items) { item in
                            SnykIssueRow(item: item)
                        }
                    }
                }
            }
        }
        .navigationTitle("Snyk")
        .toolbar {
            ToolbarItem {
                Button {
                    Task { await model.refreshSnyk() }
                } label: {
                    Label("Refresh Snyk", systemImage: "arrow.clockwise")
                }
            }
        }
    }
}

struct JiraView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List {
            Section("Assigned Tickets") {
                switch model.jiraTickets {
                case .idle:
                    StatusRow(text: "Not checked", symbolName: "clock")
                case .loading:
                    LoadingRow()
                case let .notConfigured(message), let .failed(message):
                    StatusRow(text: message, symbolName: "exclamationmark.triangle")
                case let .loaded(items, _):
                    if items.isEmpty {
                        StatusRow(text: "No assigned tickets", symbolName: "checkmark.circle")
                    } else {
                        ForEach(items) { item in
                            JiraTicketRow(item: item)
                        }
                    }
                }
            }
        }
        .navigationTitle("Jira")
        .toolbar {
            ToolbarItem {
                Button {
                    Task { await model.refreshJira() }
                } label: {
                    Label("Refresh Jira", systemImage: "arrow.clockwise")
                }
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Form {
            Section("GitHub") {
                SecureField("New token", text: $model.draft.githubToken)
                HStack {
                    Label(model.hasSavedGitHubToken ? "Token saved" : "Token not saved", systemImage: model.hasSavedGitHubToken ? "checkmark.circle" : "key")
                    Spacer()
                    Button {
                        model.removeGitHubToken()
                    } label: {
                        Label("Remove", systemImage: "trash")
                    }
                    .disabled(!model.hasSavedGitHubToken)
                }
            }

            Section("Snyk") {
                SecureField("New token", text: $model.draft.snykToken)
                Picker("API base URL", selection: $model.draft.snykAPIBaseURL) {
                    Text(defaultSnykAPIBaseURL).tag(defaultSnykAPIBaseURL)
                    Text(alternateSnykAPIBaseURL).tag(alternateSnykAPIBaseURL)
                }
                HStack {
                    Label(model.hasSavedSnykToken ? "Token saved" : "Token not saved", systemImage: model.hasSavedSnykToken ? "checkmark.circle" : "key")
                    Spacer()
                    Button {
                        model.removeSnykToken()
                    } label: {
                        Label("Remove", systemImage: "trash")
                    }
                    .disabled(!model.hasSavedSnykToken)
                }
            }

            Section("Jira") {
                TextField("Base URL", text: $model.draft.jiraBaseURL)
                TextField("Email", text: $model.draft.jiraEmail)
                SecureField("New API token", text: $model.draft.jiraAPIToken)
                TextField("Cloud ID", text: $model.draft.jiraCloudID)
                HStack {
                    Label(model.hasSavedJiraToken ? "API token saved" : "API token not saved", systemImage: model.hasSavedJiraToken ? "checkmark.circle" : "key")
                    Spacer()
                    Button {
                        model.clearJiraCredentials()
                    } label: {
                        Label("Clear", systemImage: "trash")
                    }
                }
            }

            Section {
                Button {
                    Task { await model.saveSettings() }
                } label: {
                    Label(model.isSavingSettings ? "Saving" : "Save Settings", systemImage: "square.and.arrow.down")
                }
                .disabled(model.isSavingSettings)

                if let message = model.settingsMessage {
                    Text(message)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Settings")
    }
}

struct GitHubNotificationRow: View {
    let item: GitHubNotificationItem

    var body: some View {
        Link(destination: item.url) {
            RowLayout(
                symbolName: item.isUnread ? "circle.fill" : "circle",
                title: item.title,
                subtitle: "\(item.repository) - \(item.type) - \(item.reason)",
                trailing: relativeTime(item.updatedAt)
            )
        }
    }
}

struct DependabotAlertRow: View {
    let item: DependabotAlertItem

    var body: some View {
        Link(destination: item.url) {
            RowLayout(
                symbolName: "shield.lefthalf.filled",
                title: item.summary,
                subtitle: "\(item.repository) - \(item.packageName) - \(item.severity.uppercased())",
                trailing: item.patchedVersion ?? "no patch"
            )
        }
    }
}

struct WorkflowRunRow: View {
    let item: FailedWorkflowRunItem

    var body: some View {
        Link(destination: item.url) {
            RowLayout(
                symbolName: "xmark.octagon",
                title: item.title,
                subtitle: "\(item.repository) - \(item.workflowName)\(item.branch.map { " - \($0)" } ?? "")",
                trailing: relativeTime(item.updatedAt)
            )
        }
    }
}

struct SnykIssueRow: View {
    let item: SnykIssueItem

    var body: some View {
        Link(destination: item.url) {
            RowLayout(
                symbolName: "exclamationmark.triangle",
                title: item.title,
                subtitle: "\(item.organizationName) - \(item.projectName) - \(item.severity.uppercased())",
                trailing: item.packageName ?? item.issueType
            )
        }
    }
}

struct JiraTicketRow: View {
    let item: JiraTicketItem

    var body: some View {
        Link(destination: item.url) {
            RowLayout(
                symbolName: "checklist",
                title: item.summary,
                subtitle: "\(item.key) - \(item.issueType) - \(item.status)",
                trailing: relativeTime(item.updatedAt)
            )
        }
    }
}

struct RowLayout: View {
    let symbolName: String
    let title: String
    let subtitle: String
    let trailing: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbolName)
                .foregroundStyle(Color.accentColor)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                    .lineLimit(2)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 12)
            Text(trailing)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.vertical, 4)
    }
}

struct LoadingRow: View {
    var body: some View {
        HStack {
            ProgressView()
            Text("Checking")
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

struct StatusRow: View {
    let text: String
    let symbolName: String

    var body: some View {
        Label(text, systemImage: symbolName)
            .foregroundStyle(.secondary)
            .padding(.vertical, 4)
    }
}

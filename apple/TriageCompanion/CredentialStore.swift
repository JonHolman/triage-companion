import Foundation
import Security

enum CredentialKey: CaseIterable {
    case githubToken
    case snykToken
    case snykAPIBaseURL
    case jiraBaseURL
    case jiraEmail
    case jiraAPIToken
    case jiraCloudID

    var service: String {
        switch self {
        case .githubToken:
            return "Triage Companion-GitHub"
        case .snykToken:
            return "Triage Companion-Snyk"
        case .snykAPIBaseURL:
            return "Triage Companion-Config"
        case .jiraBaseURL, .jiraEmail, .jiraAPIToken, .jiraCloudID:
            return "Triage Companion-Jira"
        }
    }

    var account: String {
        switch self {
        case .githubToken:
            return "notifications-token"
        case .snykToken:
            return "token"
        case .snykAPIBaseURL:
            return "snyk-api-base-url"
        case .jiraBaseURL:
            return "base-url"
        case .jiraEmail:
            return "email"
        case .jiraAPIToken:
            return "api-token"
        case .jiraCloudID:
            return "cloud-id"
        }
    }

    var storageKey: String {
        let separator = String(UnicodeScalar(31)!)
        return "\(service)\(separator)\(account)"
    }
}

protocol CredentialStoring {
    func read(_ key: CredentialKey) throws -> String?
    func save(_ value: String?, for key: CredentialKey) throws
}

#if os(macOS)
final class AppCredentialStore: CredentialStoring {
    private let fileManager: FileManager

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    func read(_ key: CredentialKey) throws -> String? {
        try loadValues()[key.storageKey]
    }

    func save(_ value: String?, for key: CredentialKey) throws {
        var values = try loadValues()
        if let value {
            values[key.storageKey] = value
        } else {
            values.removeValue(forKey: key.storageKey)
        }

        try writeValues(values)
    }

    private var storeURL: URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("Triage Companion", isDirectory: true)
            .appendingPathComponent("secrets.json", isDirectory: false)
    }

    private func loadValues() throws -> [String: String] {
        let url = storeURL
        guard fileManager.fileExists(atPath: url.path) else {
            return [:]
        }

        let data = try Data(contentsOf: url)
        let value = try JSONSerialization.jsonObject(with: data)
        guard let object = value as? [String: Any] else {
            throw TriageCompanionError.message("Credential store must contain a JSON object.")
        }

        var values: [String: String] = [:]
        for (key, value) in object {
            guard let stringValue = value as? String else {
                throw TriageCompanionError.message("Credential store values must be strings.")
            }
            values[key] = stringValue
        }

        return values
    }

    private func writeValues(_ values: [String: String]) throws {
        let url = storeURL
        let directoryURL = url.deletingLastPathComponent()
        try fileManager.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )

        let data = try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])
        try data.write(to: url, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
#else
final class AppCredentialStore: CredentialStoring {
    func read(_ key: CredentialKey) throws -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw keychainError(status)
        }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw TriageCompanionError.message("Stored credential could not be decoded.")
        }

        return value
    }

    func save(_ value: String?, for key: CredentialKey) throws {
        guard let value else {
            let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
            if status == errSecItemNotFound || status == errSecSuccess {
                return
            }
            throw keychainError(status)
        }

        let data = Data(value.utf8)
        let status = SecItemUpdate(
            baseQuery(for: key) as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if status == errSecSuccess {
            return
        }
        if status != errSecItemNotFound {
            throw keychainError(status)
        }

        var item = baseQuery(for: key)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw keychainError(addStatus)
        }
    }

    private func baseQuery(for key: CredentialKey) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: key.service,
            kSecAttrAccount as String: key.account
        ]
    }

    private func keychainError(_ status: OSStatus) -> TriageCompanionError {
        let message = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)."
        return .message(message)
    }
}
#endif

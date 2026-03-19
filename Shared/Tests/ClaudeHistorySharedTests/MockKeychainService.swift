@testable import ClaudeHistoryShared

/// In-memory keychain for testing — no Keychain persistence, fully isolated
final class MockKeychainService: KeychainService, @unchecked Sendable {
    private var storedKey: String?

    init(apiKey: String? = nil) {
        self.storedKey = apiKey
    }

    func saveAPIKey(_ key: String) throws {
        storedKey = key
    }

    func getAPIKey() -> String? {
        storedKey
    }

    func deleteAPIKey() throws {
        storedKey = nil
    }

    func hasAPIKey() -> Bool {
        storedKey != nil
    }
}

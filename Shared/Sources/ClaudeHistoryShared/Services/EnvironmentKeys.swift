import SwiftUI

// MARK: - APIClient Environment Key

private struct APIClientKey: EnvironmentKey {
    static let defaultValue: APIClient? = nil
}

public extension EnvironmentValues {
    var apiClient: APIClient? {
        get { self[APIClientKey.self] }
        set { self[APIClientKey.self] = newValue }
    }
}

// MARK: - WebSocketClient Environment Key

private struct WebSocketClientKey: EnvironmentKey {
    static let defaultValue: WebSocketClient? = nil
}

public extension EnvironmentValues {
    var webSocketClient: WebSocketClient? {
        get { self[WebSocketClientKey.self] }
        set { self[WebSocketClientKey.self] = newValue }
    }
}

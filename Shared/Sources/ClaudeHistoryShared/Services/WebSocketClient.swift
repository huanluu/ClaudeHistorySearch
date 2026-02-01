import Foundation

/// Message types for WebSocket communication
public enum WSMessageType: String, Codable {
    case ping
    case pong
    case auth
    case authResult = "auth_result"
    case error
    case message
    // Session types
    case sessionStart = "session.start"
    case sessionResume = "session.resume"
    case sessionCancel = "session.cancel"
    case sessionOutput = "session.output"
    case sessionError = "session.error"
    case sessionComplete = "session.complete"
}

/// WebSocket message structure
public struct WSMessage: Codable {
    public let type: WSMessageType
    public let payload: AnyCodable?
    public let id: String?

    public init(type: WSMessageType, payload: AnyCodable? = nil, id: String? = nil) {
        self.type = type
        self.payload = payload
        self.id = id
    }
}

/// Authentication result payload
public struct AuthResultPayload: Codable {
    public let success: Bool
    public let message: String?
}

// MARK: - Session Payloads

/// Payload for session.start message
public struct SessionStartPayload: Codable {
    public let sessionId: String
    public let prompt: String
    public let workingDir: String

    public init(sessionId: String, prompt: String, workingDir: String) {
        self.sessionId = sessionId
        self.prompt = prompt
        self.workingDir = workingDir
    }
}

/// Payload for session.resume message
public struct SessionResumePayload: Codable {
    public let sessionId: String
    public let resumeSessionId: String
    public let prompt: String
    public let workingDir: String

    public init(sessionId: String, resumeSessionId: String, prompt: String, workingDir: String) {
        self.sessionId = sessionId
        self.resumeSessionId = resumeSessionId
        self.prompt = prompt
        self.workingDir = workingDir
    }
}

/// Payload for session.cancel message
public struct SessionCancelPayload: Codable {
    public let sessionId: String

    public init(sessionId: String) {
        self.sessionId = sessionId
    }
}

/// Payload for session.output message
public struct SessionOutputPayload: Codable {
    public let sessionId: String
    public let message: AnyCodable
}

/// Payload for session.error message
public struct SessionErrorPayload: Codable {
    public let sessionId: String
    public let error: String
}

/// Payload for session.complete message
public struct SessionCompletePayload: Codable {
    public let sessionId: String
    public let exitCode: Int
}

/// Type-erased Codable wrapper for dynamic payloads
public struct AnyCodable: Codable {
    public let value: Any

    public init(_ value: Any) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if container.decodeNil() {
            value = NSNull()
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unable to decode value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let string as String:
            try container.encode(string)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let bool as Bool:
            try container.encode(bool)
        case is NSNull:
            try container.encodeNil()
        default:
            throw EncodingError.invalidValue(value, EncodingError.Context(codingPath: encoder.codingPath, debugDescription: "Unable to encode value"))
        }
    }
}

/// WebSocket connection state
public enum WebSocketState {
    case disconnected
    case connecting
    case connected
    case authenticated
}

/// WebSocket error types
public enum WebSocketError: LocalizedError {
    case notConnected
    case authenticationFailed(String?)
    case connectionFailed(Error)
    case encodingError
    case invalidURL

    public var errorDescription: String? {
        switch self {
        case .notConnected:
            return "WebSocket not connected"
        case .authenticationFailed(let message):
            return message ?? "Authentication failed"
        case .connectionFailed(let error):
            return "Connection failed: \(error.localizedDescription)"
        case .encodingError:
            return "Failed to encode message"
        case .invalidURL:
            return "Invalid WebSocket URL"
        }
    }
}

/// WebSocket client for real-time communication with the server
@MainActor
public class WebSocketClient: ObservableObject {
    @Published public private(set) var state: WebSocketState = .disconnected
    @Published public private(set) var error: WebSocketError?

    private var webSocketTask: URLSessionWebSocketTask?
    private var pingTimer: Timer?
    private var apiKey: String?
    private var baseURL: URL?

    /// Message handler callback
    public var onMessage: ((WSMessage) -> Void)?

    /// Connection state change callback
    public var onStateChange: ((WebSocketState) -> Void)?

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init() {}

    /// Configure the WebSocket connection
    public func configure(baseURL: URL, apiKey: String?) {
        self.baseURL = baseURL
        self.apiKey = apiKey
    }

    /// Connect to the WebSocket server
    public func connect() async throws {
        guard let baseURL = baseURL else {
            throw WebSocketError.invalidURL
        }

        // Build WebSocket URL with API key
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        components.path = "/ws"

        if let apiKey = apiKey {
            components.queryItems = [URLQueryItem(name: "apiKey", value: apiKey)]
        }

        guard let wsURL = components.url else {
            throw WebSocketError.invalidURL
        }

        state = .connecting
        onStateChange?(.connecting)

        let session = URLSession(configuration: .default)
        webSocketTask = session.webSocketTask(with: wsURL)
        webSocketTask?.resume()

        // Start receiving messages
        receiveMessage()

        // Wait for auth result
        try await waitForAuthentication()

        // Start ping timer
        startPingTimer()
    }

    /// Disconnect from the WebSocket server
    public func disconnect() {
        stopPingTimer()
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        state = .disconnected
        onStateChange?(.disconnected)
    }

    /// Send a message to the server
    public func send(_ message: WSMessage) async throws {
        guard state == .authenticated else {
            throw WebSocketError.notConnected
        }

        guard let data = try? encoder.encode(message),
              let string = String(data: data, encoding: .utf8) else {
            throw WebSocketError.encodingError
        }

        try await webSocketTask?.send(.string(string))
    }

    /// Send a ping message
    public func sendPing() async {
        let pingMessage = WSMessage(type: .ping, id: UUID().uuidString)
        try? await send(pingMessage)
    }

    // MARK: - Private Methods

    private func waitForAuthentication() async throws {
        // Wait up to 5 seconds for auth result
        let timeout = Date().addingTimeInterval(5)

        while state == .connecting && Date() < timeout {
            try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        }

        if state != .authenticated {
            disconnect()
            throw WebSocketError.authenticationFailed(error?.localizedDescription)
        }
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success(let message):
                    self?.handleMessage(message)
                    // Continue receiving
                    self?.receiveMessage()

                case .failure(let error):
                    self?.handleError(error)
                }
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            print("[WebSocketClient] Received text message: \(text.prefix(200))...")

            guard let data = text.data(using: .utf8),
                  let wsMessage = try? decoder.decode(WSMessage.self, from: data) else {
                print("[WebSocketClient] Failed to decode message")
                return
            }

            print("[WebSocketClient] Decoded message type: \(wsMessage.type)")

            switch wsMessage.type {
            case .authResult:
                handleAuthResult(wsMessage)
            case .pong:
                // Pong received - connection is alive
                break
            case .error:
                if let payload = wsMessage.payload?.value as? [String: Any],
                   let message = payload["message"] as? String {
                    error = .authenticationFailed(message)
                }
            default:
                // Forward to message handler
                print("[WebSocketClient] Forwarding to onMessage handler (handler exists: \(onMessage != nil))")
                onMessage?(wsMessage)
            }

        case .data:
            // Binary data not expected
            break

        @unknown default:
            break
        }
    }

    private func handleAuthResult(_ message: WSMessage) {
        if let payload = message.payload?.value as? [String: Any],
           let success = payload["success"] as? Bool {
            if success {
                state = .authenticated
                onStateChange?(.authenticated)
            } else {
                let errorMessage = payload["message"] as? String
                error = .authenticationFailed(errorMessage)
                disconnect()
            }
        }
    }

    private func handleError(_ error: Error) {
        self.error = .connectionFailed(error)
        state = .disconnected
        onStateChange?(.disconnected)
        stopPingTimer()
    }

    private func startPingTimer() {
        pingTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.sendPing()
            }
        }
    }

    private func stopPingTimer() {
        pingTimer?.invalidate()
        pingTimer = nil
    }
}

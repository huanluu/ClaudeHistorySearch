import Foundation
import Combine

/// ViewModel for managing session state and interactions.
/// Supports both historical viewing and live session execution.
@MainActor
public class SessionViewModel: ObservableObject {
    // MARK: - Published State

    /// Current mode (historical or live)
    @Published public internal(set) var mode: SessionMode = .historical

    /// Current state of live session (idle, running, completed, etc.)
    @Published public internal(set) var state: SessionState = .idle

    /// Messages in the current session
    @Published public internal(set) var messages: [Message] = []

    /// Error message if any
    @Published public internal(set) var error: String?

    /// Whether data is currently loading
    @Published public internal(set) var isLoading: Bool = false

    // MARK: - Dependencies

    private let webSocketClient: WebSocketClient?
    private let apiClient: (any NetworkService)?

    // MARK: - Session Info

    /// Current session ID (for live sessions)
    public internal(set) var sessionId: String?

    /// Working directory for the session
    public internal(set) var workingDir: String?

    // MARK: - Initialization

    /// Initialize for historical session viewing
    public init(apiClient: any NetworkService) {
        self.apiClient = apiClient
        self.webSocketClient = nil
        self.mode = .historical
    }

    /// Initialize for live session execution
    public init(webSocketClient: WebSocketClient) {
        self.webSocketClient = webSocketClient
        self.apiClient = nil
        self.mode = .live
    }

    /// Initialize with both clients (for resuming sessions)
    public init(apiClient: any NetworkService, webSocketClient: WebSocketClient) {
        self.apiClient = apiClient
        self.webSocketClient = webSocketClient
        self.mode = .historical  // Starts historical, can switch to live
    }

    // MARK: - Historical Session Methods

    /// Load a historical session by ID
    public func loadSession(id: String) async throws {
        guard let apiClient = apiClient else {
            throw SessionViewModelError.noAPIClient
        }

        isLoading = true
        error = nil

        do {
            let response = try await apiClient.fetchSession(id: id)
            self.messages = response.messages
            self.sessionId = id
            isLoading = false
        } catch {
            self.error = error.localizedDescription
            isLoading = false
            throw error
        }
    }

    // MARK: - Live Session Methods

    /// Start a new live session with the given prompt
    /// - Parameters:
    ///   - prompt: The initial prompt to send to Claude
    ///   - workingDir: The working directory for the session
    public func startSession(prompt: String, workingDir: String) async throws {
        guard let webSocketClient = webSocketClient else {
            throw SessionViewModelError.noWebSocketClient
        }

        // Generate unique session ID
        let newSessionId = UUID().uuidString
        self.sessionId = newSessionId
        self.workingDir = workingDir
        self.state = .running
        self.mode = .live
        self.error = nil

        // Send session.start message
        let message = WSMessage(
            type: .sessionStart,
            payload: AnyCodable([
                "sessionId": newSessionId,
                "prompt": prompt,
                "workingDir": workingDir
            ])
        )

        try await webSocketClient.send(message)
    }

    /// Resume a historical session with a follow-up prompt
    /// - Parameters:
    ///   - resumeSessionId: The ID of the historical session to resume
    ///   - prompt: The follow-up prompt
    ///   - workingDir: The working directory
    public func resumeSession(resumeSessionId: String, prompt: String, workingDir: String) async throws {
        guard let webSocketClient = webSocketClient else {
            throw SessionViewModelError.noWebSocketClient
        }

        // Generate unique session ID for this interaction
        let newSessionId = UUID().uuidString
        self.sessionId = newSessionId
        self.workingDir = workingDir
        self.state = .running
        self.mode = .live
        self.error = nil

        // Send session.resume message
        let message = WSMessage(
            type: .sessionResume,
            payload: AnyCodable([
                "sessionId": newSessionId,
                "resumeSessionId": resumeSessionId,
                "prompt": prompt,
                "workingDir": workingDir
            ])
        )

        try await webSocketClient.send(message)
    }

    /// Cancel the currently running session
    public func cancel() {
        guard let sessionId = sessionId else { return }

        state = .cancelled

        // Send cancel message (fire and forget)
        Task {
            let message = WSMessage(
                type: .sessionCancel,
                payload: AnyCodable(["sessionId": sessionId])
            )
            try? await webSocketClient?.send(message)
        }
    }

    // MARK: - WebSocket Message Handling

    /// Handle incoming WebSocket messages
    public func handleWebSocketMessage(_ message: WSMessage) {
        guard let payload = message.payload?.value as? [String: Any],
              let messageSessionId = payload["sessionId"] as? String,
              messageSessionId == self.sessionId else {
            return  // Ignore messages for other sessions
        }

        switch message.type {
        case .sessionOutput:
            handleSessionOutput(payload)

        case .sessionError:
            if let errorMessage = payload["error"] as? String {
                self.error = errorMessage
            }

        case .sessionComplete:
            if let exitCode = payload["exitCode"] as? Int {
                self.state = .completed(exitCode: exitCode)
            }

        default:
            break
        }
    }

    /// Handle session output message
    private func handleSessionOutput(_ payload: [String: Any]) {
        guard let messageData = payload["message"] as? [String: Any] else { return }

        // Parse the Claude output format and convert to Message
        // The output format from `claude -p --output-format stream-json` varies,
        // but we'll extract the essentials
        if let content = extractContent(from: messageData) {
            let role = (messageData["type"] as? String) ?? "assistant"
            let uuid = messageData["uuid"] as? String ?? UUID().uuidString
            let timestamp = messageData["timestamp"] as? Int64

            let newMessage = Message(
                uuid: uuid,
                role: role,
                content: content,
                timestamp: timestamp
            )
            messages.append(newMessage)
        }
    }

    /// Extract text content from Claude output message
    private func extractContent(from messageData: [String: Any]) -> String? {
        // Handle different output formats from Claude
        if let content = messageData["content"] as? String {
            return content
        }

        // Handle array content format
        if let contentArray = messageData["content"] as? [[String: Any]] {
            let texts = contentArray.compactMap { item -> String? in
                if item["type"] as? String == "text" {
                    return item["text"] as? String
                }
                return nil
            }
            if !texts.isEmpty {
                return texts.joined(separator: "\n")
            }
        }

        return nil
    }

    // MARK: - Testing Helpers

    /// Set session ID for testing purposes
    internal func setSessionIdForTesting(_ id: String) {
        self.sessionId = id
    }

    /// Set state for testing purposes
    internal func setStateForTesting(_ newState: SessionState) {
        self.state = newState
    }
}

// MARK: - Errors

public enum SessionViewModelError: LocalizedError {
    case noAPIClient
    case noWebSocketClient
    case notImplemented
    case sessionNotFound
    case invalidState(String)

    public var errorDescription: String? {
        switch self {
        case .noAPIClient:
            return "API client not configured"
        case .noWebSocketClient:
            return "WebSocket client not configured"
        case .notImplemented:
            return "This feature is not yet implemented"
        case .sessionNotFound:
            return "Session not found"
        case .invalidState(let message):
            return "Invalid state: \(message)"
        }
    }
}

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

    /// The original Claude session ID being resumed (persists across follow-ups)
    public internal(set) var resumeSessionId: String?

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

        // Ensure WebSocket is connected
        try await ensureWebSocketConnected()

        // Generate unique session ID
        let newSessionId = UUID().uuidString
        self.sessionId = newSessionId
        self.workingDir = workingDir
        self.state = .running
        self.mode = .live
        self.error = nil

        // Wire up message handler to receive responses
        setupMessageHandler()

        // Add user's prompt to messages (Claude doesn't echo it back in -p mode)
        let userMessage = Message(
            uuid: UUID().uuidString,
            role: "user",
            content: prompt,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        )
        messages.append(userMessage)

        // Send session.start message
        let message = WSMessage(
            type: .sessionStart,
            payload: AnyCodable([
                "sessionId": newSessionId,
                "prompt": prompt,
                "workingDir": workingDir
            ])
        )

        print("[SessionViewModel] Sending session.start for session: \(newSessionId)")
        try await webSocketClient.send(message)
        print("[SessionViewModel] session.start sent successfully")
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

        // Ensure WebSocket is connected
        try await ensureWebSocketConnected()

        // Generate unique session ID for this interaction
        let newSessionId = UUID().uuidString
        self.sessionId = newSessionId
        self.resumeSessionId = resumeSessionId  // Store for follow-ups
        self.workingDir = workingDir
        self.state = .running
        self.mode = .live
        self.error = nil

        // Wire up message handler to receive responses
        setupMessageHandler()

        // Add user's prompt to messages (Claude doesn't echo it back in -p mode)
        let userMessage = Message(
            uuid: UUID().uuidString,
            role: "user",
            content: prompt,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        )
        messages.append(userMessage)

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

        print("[SessionViewModel] Sending session.resume for session: \(newSessionId), resuming: \(resumeSessionId)")
        try await webSocketClient.send(message)
        print("[SessionViewModel] session.resume sent successfully")
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

    /// Send a follow-up message in the current session
    public func sendFollowUp(prompt: String) async throws {
        guard let resumeSessionId = resumeSessionId,
              let workingDir = workingDir else {
            throw SessionViewModelError.invalidState("No active session to follow up")
        }

        guard state.canSendMessage else {
            throw SessionViewModelError.invalidState("Session is not ready for input")
        }

        guard let webSocketClient = webSocketClient else {
            throw SessionViewModelError.noWebSocketClient
        }

        // Ensure WebSocket is connected
        try await ensureWebSocketConnected()

        // Generate new session ID for this turn
        let newSessionId = UUID().uuidString
        self.sessionId = newSessionId
        self.state = .running
        self.error = nil

        // Wire up message handler
        setupMessageHandler()

        // Add user's prompt to messages
        let userMessage = Message(
            uuid: UUID().uuidString,
            role: "user",
            content: prompt,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        )
        messages.append(userMessage)

        // Send session.resume message (reusing the original resumeSessionId)
        let message = WSMessage(
            type: .sessionResume,
            payload: AnyCodable([
                "sessionId": newSessionId,
                "resumeSessionId": resumeSessionId,
                "prompt": prompt,
                "workingDir": workingDir
            ])
        )

        print("[SessionViewModel] Sending follow-up for session: \(newSessionId), resuming: \(resumeSessionId)")
        try await webSocketClient.send(message)
    }

    /// Set up the WebSocket message handler to receive session responses
    private func setupMessageHandler() {
        print("[SessionViewModel] Setting up message handler for session: \(sessionId ?? "nil")")
        webSocketClient?.onMessage = { [weak self] message in
            print("[SessionViewModel] Received WebSocket message: \(message.type)")
            Task { @MainActor in
                self?.handleWebSocketMessage(message)
            }
        }
    }

    /// Ensure WebSocket is connected, attempting reconnection if needed
    private func ensureWebSocketConnected() async throws {
        guard let webSocketClient = webSocketClient else {
            throw SessionViewModelError.noWebSocketClient
        }

        // If already authenticated, we're good
        if webSocketClient.state == .authenticated {
            print("[SessionViewModel] WebSocket already authenticated")
            return
        }

        // If disconnected, try to reconnect
        if webSocketClient.state == .disconnected {
            print("[SessionViewModel] WebSocket disconnected, attempting reconnection...")
            do {
                try await webSocketClient.connect()
                print("[SessionViewModel] WebSocket reconnection successful")
            } catch {
                print("[SessionViewModel] WebSocket reconnection failed: \(error)")
                throw SessionViewModelError.invalidState("WebSocket connection failed: \(error.localizedDescription)")
            }
        }

        // If still connecting, wait a bit
        if webSocketClient.state == .connecting {
            print("[SessionViewModel] WebSocket still connecting, waiting...")
            // Wait up to 5 seconds for authentication
            for _ in 0..<50 {
                try await Task.sleep(nanoseconds: 100_000_000) // 100ms
                if webSocketClient.state == .authenticated {
                    print("[SessionViewModel] WebSocket authentication completed")
                    return
                }
                if webSocketClient.state == .disconnected {
                    throw SessionViewModelError.invalidState("WebSocket connection failed")
                }
            }
            throw SessionViewModelError.invalidState("WebSocket connection timeout")
        }
    }

    // MARK: - WebSocket Message Handling

    /// Handle incoming WebSocket messages
    public func handleWebSocketMessage(_ message: WSMessage) {
        print("[SessionViewModel] handleWebSocketMessage: type=\(message.type)")

        guard let payload = message.payload?.value as? [String: Any] else {
            print("[SessionViewModel] No payload in message")
            return
        }

        guard let messageSessionId = payload["sessionId"] as? String else {
            print("[SessionViewModel] No sessionId in payload: \(payload)")
            return
        }

        guard messageSessionId == self.sessionId else {
            print("[SessionViewModel] Session ID mismatch: got \(messageSessionId), expected \(self.sessionId ?? "nil")")
            return  // Ignore messages for other sessions
        }

        print("[SessionViewModel] Processing message for session: \(messageSessionId)")

        switch message.type {
        case .sessionOutput:
            handleSessionOutput(payload)

        case .sessionError:
            if let errorMessage = payload["error"] as? String {
                self.error = errorMessage
            }

        case .sessionComplete:
            if let exitCode = payload["exitCode"] as? Int {
                // If successful (exitCode 0), mark as ready for follow-up
                // Otherwise mark as completed with error code
                if exitCode == 0 {
                    self.state = .ready
                } else {
                    self.state = .completed(exitCode: exitCode)
                }
            }

        default:
            break
        }
    }

    /// Handle session output message
    private func handleSessionOutput(_ payload: [String: Any]) {
        guard let messageData = payload["message"] as? [String: Any] else {
            print("[SessionViewModel] handleSessionOutput: no message in payload")
            return
        }

        let messageType = messageData["type"] as? String ?? "unknown"
        print("[SessionViewModel] handleSessionOutput: type=\(messageType)")

        // Parse based on message type from Claude's stream-json format
        switch messageType {
        case "assistant":
            // Format: {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
            if let innerMessage = messageData["message"] as? [String: Any],
               let content = extractContent(from: innerMessage) {
                let uuid = messageData["uuid"] as? String ?? UUID().uuidString
                let newMessage = Message(
                    uuid: uuid,
                    role: "assistant",
                    content: content,
                    timestamp: nil
                )
                messages.append(newMessage)
                print("[SessionViewModel] Added assistant message: \(content.prefix(50))...")
            }

        case "user":
            // Format: {"type":"user","message":{"content":[{"type":"text","text":"..."}]}}
            if let innerMessage = messageData["message"] as? [String: Any],
               let content = extractContent(from: innerMessage) {
                let uuid = messageData["uuid"] as? String ?? UUID().uuidString
                let newMessage = Message(
                    uuid: uuid,
                    role: "user",
                    content: content,
                    timestamp: nil
                )
                messages.append(newMessage)
                print("[SessionViewModel] Added user message: \(content.prefix(50))...")
            }

        case "result":
            // Format: {"type":"result","result":"...","subtype":"success"}
            if let result = messageData["result"] as? String {
                print("[SessionViewModel] Session result: \(result.prefix(100))...")
                // Don't add result as a message - it's metadata
            }

        case "system":
            // Format: {"type":"system","subtype":"init",...}
            print("[SessionViewModel] System message: \(messageData["subtype"] ?? "unknown")")
            // Don't add system messages to the UI

        default:
            print("[SessionViewModel] Unknown message type: \(messageType)")
        }
    }

    /// Extract text content from Claude's inner message format
    private func extractContent(from innerMessage: [String: Any]) -> String? {
        // Handle string content directly
        if let content = innerMessage["content"] as? String {
            return content
        }

        // Handle array content format: [{"type":"text","text":"..."}]
        if let contentArray = innerMessage["content"] as? [[String: Any]] {
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

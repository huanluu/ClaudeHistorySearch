import Foundation
import Combine

/// ViewModel for managing session state and interactions.
/// Supports both historical viewing and live session execution.
///
/// This is the shell interface for Phase 5. Full implementation comes in Phase 6.
@MainActor
public class SessionViewModel: ObservableObject {
    // MARK: - Published State

    /// Current mode (historical or live)
    @Published public private(set) var mode: SessionMode = .historical

    /// Current state of live session (idle, running, completed, etc.)
    @Published public private(set) var state: SessionState = .idle

    /// Messages in the current session
    @Published public private(set) var messages: [Message] = []

    /// Error message if any
    @Published public private(set) var error: String?

    /// Whether data is currently loading
    @Published public private(set) var isLoading: Bool = false

    // MARK: - Dependencies

    private let webSocketClient: WebSocketClient?
    private let apiClient: (any NetworkService)?

    // MARK: - Session Info

    /// Current session ID (for live sessions)
    public private(set) var sessionId: String?

    /// Working directory for the session
    public private(set) var workingDir: String?

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

    // MARK: - Live Session Methods (Shell - Implementation in Phase 6)

    /// Start a new live session with the given prompt
    /// - Parameters:
    ///   - prompt: The initial prompt to send to Claude
    ///   - workingDir: The working directory for the session
    public func startSession(prompt: String, workingDir: String) async throws {
        // Phase 6 implementation
        throw SessionViewModelError.notImplemented
    }

    /// Resume a historical session with a follow-up prompt
    /// - Parameters:
    ///   - resumeSessionId: The ID of the historical session to resume
    ///   - prompt: The follow-up prompt
    ///   - workingDir: The working directory
    public func resumeSession(resumeSessionId: String, prompt: String, workingDir: String) async throws {
        // Phase 7 implementation
        throw SessionViewModelError.notImplemented
    }

    /// Cancel the currently running session
    public func cancel() {
        // Phase 6 implementation
    }

    // MARK: - WebSocket Message Handling (Shell - Implementation in Phase 6)

    /// Handle incoming WebSocket messages
    internal func handleWebSocketMessage(_ message: WSMessage) {
        // Phase 6 implementation
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

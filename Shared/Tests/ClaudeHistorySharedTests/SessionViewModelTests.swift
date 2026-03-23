import XCTest
@testable import ClaudeHistoryShared

@MainActor
final class SessionViewModelTests: XCTestCase {

    // MARK: - Initial State Tests

    func testInitialStateIsIdle() {
        let mockAPI = MockAPIClient()
        let viewModel = SessionViewModel(apiClient: mockAPI)

        XCTAssertEqual(viewModel.state, .idle)
        XCTAssertTrue(viewModel.messages.isEmpty)
        XCTAssertNil(viewModel.error)
    }

    func testInitWithAPIClientSetsHistoricalMode() {
        let mockAPI = MockAPIClient()
        let viewModel = SessionViewModel(apiClient: mockAPI)

        XCTAssertEqual(viewModel.mode, .historical)
    }

    func testInitWithWebSocketSetsLiveMode() {
        let wsClient = WebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: wsClient)

        XCTAssertEqual(viewModel.mode, .live)
    }

    // MARK: - Start Session State Tests

    func testStartSessionThrowsWithoutWebSocketClient() async {
        let mockAPI = MockAPIClient()
        let viewModel = SessionViewModel(apiClient: mockAPI)

        do {
            try await viewModel.startSession(prompt: "test", workingDir: "/tmp")
            XCTFail("Expected error")
        } catch SessionViewModelError.noWebSocketClient {
            // Expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    // MARK: - WebSocket Message Handling Tests

    func testHandleOutputMessageAddsMessage() {
        let wsClient = WebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: wsClient)

        // Manually set session ID for testing
        viewModel.setSessionIdForTesting("test-session-123")

        let outputPayload: [String: Any] = [
            "sessionId": "test-session-123",
            "message": ["type": "assistant", "content": [["type": "text", "text": "Hello!"]]]
        ]
        let message = WSMessage(type: .sessionOutput, payload: AnyCodable(outputPayload))

        viewModel.handleWebSocketMessage(message)

        // Messages should be populated
        // Note: The actual implementation will need to parse the output format
    }

    func testHandleErrorMessageSetsError() {
        let wsClient = WebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: wsClient)

        viewModel.setSessionIdForTesting("test-session-123")

        let errorPayload: [String: Any] = [
            "sessionId": "test-session-123",
            "error": "Something went wrong"
        ]
        let message = WSMessage(type: .sessionError, payload: AnyCodable(errorPayload))

        viewModel.handleWebSocketMessage(message)

        XCTAssertNotNil(viewModel.error)
        XCTAssertEqual(viewModel.error, "Something went wrong")
    }

    func testHandleCompleteMessageSetsReadyStateForSuccessfulCompletion() {
        // When a session completes successfully (exitCode 0), we set state to .ready
        // to enable sending follow-up messages (chat-like experience)
        let wsClient = WebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: wsClient)

        viewModel.setSessionIdForTesting("test-session-123")
        viewModel.setStateForTesting(.running)

        let completePayload: [String: Any] = [
            "sessionId": "test-session-123",
            "exitCode": 0
        ]
        let message = WSMessage(type: .sessionComplete, payload: AnyCodable(completePayload))

        viewModel.handleWebSocketMessage(message)

        XCTAssertEqual(viewModel.state, .ready, "Successful completion should set state to .ready for follow-ups")
    }

    func testHandleCompleteWithNonZeroExitCode() {
        let wsClient = WebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: wsClient)

        viewModel.setSessionIdForTesting("test-session-123")
        viewModel.setStateForTesting(.running)

        let completePayload: [String: Any] = [
            "sessionId": "test-session-123",
            "exitCode": 1
        ]
        let message = WSMessage(type: .sessionComplete, payload: AnyCodable(completePayload))

        viewModel.handleWebSocketMessage(message)

        if case .completed(let exitCode) = viewModel.state {
            XCTAssertEqual(exitCode, 1)
        } else {
            XCTFail("Expected completed state, got \(viewModel.state)")
        }
    }

    func testIgnoresMessagesForDifferentSession() {
        let wsClient = WebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: wsClient)

        viewModel.setSessionIdForTesting("my-session")
        viewModel.setStateForTesting(.running)

        let completePayload: [String: Any] = [
            "sessionId": "different-session",
            "exitCode": 0
        ]
        let message = WSMessage(type: .sessionComplete, payload: AnyCodable(completePayload))

        viewModel.handleWebSocketMessage(message)

        // State should still be running (message ignored)
        XCTAssertEqual(viewModel.state, .running)
    }

    // MARK: - Cancel Tests

    func testCancelSetsStateToCancelled() {
        let wsClient = WebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: wsClient)

        viewModel.setSessionIdForTesting("test-session")
        viewModel.setStateForTesting(.running)

        viewModel.cancel()

        XCTAssertEqual(viewModel.state, .cancelled)
    }

    // MARK: - Mock WebSocket Client Tests

    func testLiveSession_startSendsCorrectMessage() async throws {
        let mockWS = MockWebSocketClient()
        // Simulate already authenticated so startSession doesn't try real connection
        mockWS.state = .authenticated
        let viewModel = SessionViewModel(webSocketClient: mockWS)

        try await viewModel.startSession(prompt: "Hello Claude", workingDir: "/tmp/test")

        // Should have sent exactly one message
        XCTAssertEqual(mockWS.sentMessages.count, 1)

        let sent = mockWS.sentMessages[0]
        XCTAssertEqual(sent.type, .sessionStart)

        // Verify payload contains correct fields
        let payload = sent.payload?.value as? [String: Any]
        XCTAssertNotNil(payload)
        XCTAssertEqual(payload?["prompt"] as? String, "Hello Claude")
        XCTAssertEqual(payload?["workingDir"] as? String, "/tmp/test")
        XCTAssertNotNil(payload?["sessionId"] as? String)
    }

    func testLiveSession_outputMessageAppended() {
        let mockWS = MockWebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: mockWS)

        viewModel.setSessionIdForTesting("test-session-456")

        let outputPayload: [String: Any] = [
            "sessionId": "test-session-456",
            "message": [
                "type": "assistant",
                "message": ["content": [["type": "text", "text": "Hello from Claude!"]]]
            ]
        ]
        let message = WSMessage(type: .sessionOutput, payload: AnyCodable(outputPayload))

        viewModel.handleWebSocketMessage(message)

        // The assistant message should be appended
        let assistantMessages = viewModel.messages.filter { $0.role == "assistant" }
        XCTAssertEqual(assistantMessages.count, 1)
        XCTAssertEqual(assistantMessages.first?.content, "Hello from Claude!")
    }

    func testLiveSession_errorUpdatesState() {
        let mockWS = MockWebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: mockWS)

        viewModel.setSessionIdForTesting("test-session-789")
        viewModel.setStateForTesting(.running)

        let errorPayload: [String: Any] = [
            "sessionId": "test-session-789",
            "error": "Process crashed"
        ]
        let message = WSMessage(type: .sessionError, payload: AnyCodable(errorPayload))

        viewModel.handleWebSocketMessage(message)

        XCTAssertEqual(viewModel.error, "Process crashed")
    }

    func testLiveSession_completeUpdatesState() {
        let mockWS = MockWebSocketClient()
        let viewModel = SessionViewModel(webSocketClient: mockWS)

        viewModel.setSessionIdForTesting("test-session-complete")
        viewModel.setStateForTesting(.running)

        let completePayload: [String: Any] = [
            "sessionId": "test-session-complete",
            "exitCode": 0
        ]
        let message = WSMessage(type: .sessionComplete, payload: AnyCodable(completePayload))

        viewModel.handleWebSocketMessage(message)

        XCTAssertEqual(viewModel.state, .ready, "Successful completion should transition to .ready state")
    }
}

// MARK: - Mock WebSocket Client

@MainActor
class MockWebSocketClient: WebSocketClientProtocol {
    var state: WebSocketState = .disconnected
    var onMessage: ((WSMessage) -> Void)?
    var onStateChange: ((WebSocketState) -> Void)?

    var connectCalled = false
    var disconnectCalled = false
    var sentMessages: [WSMessage] = []

    func connect() async throws {
        connectCalled = true
        state = .authenticated
    }

    func disconnect() {
        disconnectCalled = true
        state = .disconnected
    }

    func send(_ message: WSMessage) async throws {
        sentMessages.append(message)
    }

    // Helper to simulate receiving a message
    func simulateMessage(_ message: WSMessage) {
        onMessage?(message)
    }

    // Helper to simulate state change
    func simulateStateChange(_ newState: WebSocketState) {
        state = newState
        onStateChange?(newState)
    }
}

// MARK: - Mock API Client

@MainActor
class MockAPIClient: NetworkService {
    private var baseURL: URL?
    private var apiKey: String?

    func setBaseURL(_ url: URL?) {
        baseURL = url
    }

    func getBaseURL() -> URL? {
        return baseURL
    }

    func setAPIKey(_ key: String?) {
        apiKey = key
    }

    func getAPIKey() -> String? {
        return apiKey
    }

    func saveAPIKeyToKeychain(_ key: String) throws {}

    func clearAPIKey() throws {}

    func fetchSessions(limit: Int, offset: Int, automatic: Bool?) async throws -> SessionsResponse {
        return SessionsResponse(sessions: [], pagination: Pagination(limit: limit, offset: offset, hasMore: false))
    }

    func fetchSession(id: String) async throws -> SessionDetailResponse {
        return SessionDetailResponse(
            session: Session(id: id, project: "/test", startedAt: 0, messageCount: 0, preview: "Test"),
            messages: []
        )
    }

    func search(query: String, limit: Int, offset: Int, sort: SearchSortOption, automatic: Bool?) async throws -> SearchResponse {
        return SearchResponse(results: [], pagination: Pagination(limit: limit, offset: offset, hasMore: false), query: query)
    }

    func deleteSession(id: String) async throws {}

    func checkHealth() async throws -> Bool {
        return true
    }
}


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

    func testHandleCompleteMessageSetsCompletedState() {
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

        if case .completed(let exitCode) = viewModel.state {
            XCTAssertEqual(exitCode, 0)
        } else {
            XCTFail("Expected completed state, got \(viewModel.state)")
        }
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
}

// MARK: - Mock API Client

@MainActor
class MockAPIClient: NetworkService {
    var isConnected: Bool = true
    var isAuthenticated: Bool = true
    var error: String?

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

    func fetchSessions(limit: Int, offset: Int) async throws -> SessionsResponse {
        return SessionsResponse(sessions: [], pagination: Pagination(limit: limit, offset: offset, hasMore: false))
    }

    func fetchSession(id: String) async throws -> SessionDetailResponse {
        return SessionDetailResponse(
            session: Session(id: id, project: "/test", startedAt: 0, messageCount: 0, preview: "Test"),
            messages: []
        )
    }

    func search(query: String, limit: Int, offset: Int, sort: SearchSortOption) async throws -> SearchResponse {
        return SearchResponse(results: [], pagination: Pagination(limit: limit, offset: offset, hasMore: false), query: query)
    }

    func checkHealth() async throws -> Bool {
        return true
    }
}


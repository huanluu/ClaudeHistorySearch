import XCTest
@testable import ClaudeHistoryShared

@MainActor
final class ChatViewModelTests: XCTestCase {

    private var mockWebSocketClient: MockWebSocketClient!
    private var viewModel: ChatViewModel!

    override func setUp() async throws {
        mockWebSocketClient = MockWebSocketClient()
        viewModel = ChatViewModel()
        viewModel.configure(webSocketClient: mockWebSocketClient)
    }

    // MARK: - Send Message

    func testSendMessage_addsUserAndAssistantMessages() {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()

        XCTAssertEqual(viewModel.messages.count, 2)
        XCTAssertEqual(viewModel.messages[0].role, "user")
        XCTAssertEqual(viewModel.messages[0].content, "Hello")
        XCTAssertEqual(viewModel.messages[1].role, "assistant")
        XCTAssertEqual(viewModel.messages[1].content, "")
    }

    func testSendMessage_emptyText_doesNotSend() {
        viewModel.inputText = "   "
        viewModel.sendMessage()

        XCTAssertEqual(viewModel.messages.count, 0)
        XCTAssertEqual(viewModel.chatState, .idle)
    }

    func testSendMessage_setsStreamingState() {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()

        XCTAssertEqual(viewModel.chatState, .streaming)
    }

    func testSendMessage_clearsInputText() {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()

        XCTAssertEqual(viewModel.inputText, "")
    }

    func testSendMessage_whileStreaming_doesNotSend() {
        viewModel.inputText = "First"
        viewModel.sendMessage()

        viewModel.inputText = "Second"
        viewModel.sendMessage()

        // Only the first message pair should exist
        XCTAssertEqual(viewModel.messages.count, 2)
    }

    // MARK: - Handle Delta

    func testHandleDelta_accumulatesText() {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()

        // Simulate delta messages
        simulateDelta("Hello ")
        simulateDelta("world!")

        XCTAssertEqual(viewModel.messages[1].content, "Hello world!")
    }

    // MARK: - Handle Complete

    func testHandleComplete_setsIdleState() {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()
        XCTAssertEqual(viewModel.chatState, .streaming)

        simulateComplete()

        XCTAssertEqual(viewModel.chatState, .idle)
    }

    // MARK: - Handle Error

    func testHandleError_setsErrorState() {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()

        simulateError("Something went wrong")

        XCTAssertEqual(viewModel.chatState, .error("Something went wrong"))
    }

    // MARK: - New Conversation

    func testNewConversation_clearsMessages() {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()
        XCTAssertFalse(viewModel.messages.isEmpty)

        viewModel.newConversation()

        XCTAssertTrue(viewModel.messages.isEmpty)
        XCTAssertEqual(viewModel.chatState, .idle)
        XCTAssertEqual(viewModel.inputText, "")
    }

    // MARK: - Cancel Response

    func testCancelResponse_setsIdleState() {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()
        XCTAssertEqual(viewModel.chatState, .streaming)

        viewModel.cancelResponse()

        XCTAssertEqual(viewModel.chatState, .idle)
    }

    func testCancelResponse_whenIdle_doesNothing() {
        viewModel.cancelResponse()
        XCTAssertEqual(viewModel.chatState, .idle)
    }

    // MARK: - Listening (stream-based)

    func testStartListening_receivesMessages() async {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()
        let conversationId = viewModel.conversationId

        viewModel.startListening()

        // Give the subscription task time to start
        try? await Task.sleep(nanoseconds: 50_000_000)

        // Simulate a delta message via the mock's broadcast
        let deltaMessage = WSMessage(
            type: .assistantDelta,
            payload: AnyCodable(["conversationId": conversationId, "text": "Hi there!"])
        )
        mockWebSocketClient.simulateMessage(deltaMessage)

        // Give time for delivery
        try? await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(viewModel.messages[1].content, "Hi there!")

        viewModel.stopListening()
    }

    func testStopListening_stopsReceivingMessages() async {
        viewModel.inputText = "Hello"
        viewModel.sendMessage()
        let conversationId = viewModel.conversationId

        viewModel.startListening()
        try? await Task.sleep(nanoseconds: 50_000_000)

        viewModel.stopListening()
        try? await Task.sleep(nanoseconds: 50_000_000)

        // Send a message after stopping — should NOT be received
        let deltaMessage = WSMessage(
            type: .assistantDelta,
            payload: AnyCodable(["conversationId": conversationId, "text": "Should not appear"])
        )
        mockWebSocketClient.simulateMessage(deltaMessage)
        try? await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(viewModel.messages[1].content, "", "Message should not be received after stopListening")
    }

    // MARK: - Helpers

    private func simulateDelta(_ text: String) {
        let message = WSMessage(
            type: .assistantDelta,
            payload: AnyCodable(["conversationId": viewModel.conversationId, "text": text])
        )
        viewModel.handleMessage(message)
    }

    private func simulateComplete() {
        let message = WSMessage(
            type: .assistantComplete,
            payload: AnyCodable(["conversationId": viewModel.conversationId])
        )
        viewModel.handleMessage(message)
    }

    private func simulateError(_ error: String) {
        let message = WSMessage(
            type: .assistantError,
            payload: AnyCodable(["conversationId": viewModel.conversationId, "error": error])
        )
        viewModel.handleMessage(message)
    }
}

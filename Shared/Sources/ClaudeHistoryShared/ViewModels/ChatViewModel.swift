import Foundation
import Combine

/// State of the assistant chat
public enum ChatState: Equatable {
    case idle
    case streaming
    case error(String)
}

/// ViewModel for assistant chat conversations.
/// Uses the assistant.* WebSocket protocol (simpler than session.* CLI protocol).
@MainActor
public class ChatViewModel: ObservableObject {
    // MARK: - Published State

    @Published public private(set) var messages: [Message] = []
    @Published public private(set) var chatState: ChatState = .idle
    @Published public var inputText: String = ""

    // MARK: - Private State

    internal private(set) var conversationId = UUID().uuidString
    private var webSocketClient: (any WebSocketClientProtocol)?
    private var streamingMessageIndex: Int?
    private var subscriptionTask: Task<Void, Never>?

    // MARK: - Init

    public init() {
        self.webSocketClient = nil
    }

    /// Configure the WebSocket client after init (called from view's onAppear/task)
    public func configure(webSocketClient: (any WebSocketClientProtocol)?) {
        self.webSocketClient = webSocketClient
    }

    // MARK: - Public Methods

    /// Send the current input text as a message
    public func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard chatState != .streaming else { return }

        // Add user message
        let userMessage = Message(
            uuid: UUID().uuidString,
            role: "user",
            content: text,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        )
        messages.append(userMessage)
        inputText = ""

        // Add placeholder assistant message for delta accumulation
        let assistantMessage = Message(
            uuid: UUID().uuidString,
            role: "assistant",
            content: "",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        )
        messages.append(assistantMessage)
        streamingMessageIndex = messages.count - 1
        chatState = .streaming

        // Send over WebSocket
        Task { [weak self] in
            guard let self else { return }
            do {
                let wsMessage = WSMessage(
                    type: .assistantMessage,
                    payload: AnyCodable([
                        "conversationId": self.conversationId,
                        "text": text
                    ])
                )
                try await self.webSocketClient?.send(wsMessage)
            } catch {
                self.chatState = .error("Failed to send: \(error.localizedDescription)")
                self.streamingMessageIndex = nil
            }
        }
    }

    /// Cancel the current streaming response
    public func cancelResponse() {
        guard chatState == .streaming else { return }
        chatState = .idle
        streamingMessageIndex = nil

        Task {
            let wsMessage = WSMessage(
                type: .assistantCancel,
                payload: AnyCodable(["conversationId": conversationId])
            )
            try? await webSocketClient?.send(wsMessage)
        }
    }

    /// Start a new conversation (clears messages)
    public func newConversation() {
        messages = []
        conversationId = UUID().uuidString
        chatState = .idle
        streamingMessageIndex = nil
        inputText = ""
    }

    /// Start listening for assistant WebSocket messages via multicast stream.
    /// Call from view's onAppear. Safe to call multiple times — cancels previous subscription.
    public func startListening() {
        // Cancel any existing subscription before creating a new one
        subscriptionTask?.cancel()

        guard let client = webSocketClient else { return }
        let stream = client.makeMessageStream()
        subscriptionTask = Task { [weak self] in
            for await message in stream {
                guard let self else { return }
                self.handleMessage(message)
            }
        }
    }

    /// Stop listening for WebSocket messages.
    /// Call from view's onDisappear.
    public func stopListening() {
        subscriptionTask?.cancel()
        subscriptionTask = nil
    }

    // MARK: - Message Handling

    /// Handle an incoming WebSocket message. Public for testability (matches SessionViewModel pattern).
    public func handleMessage(_ message: WSMessage) {
        switch message.type {
        case .assistantDelta:
            guard let dict = message.payload?.value as? [String: Any],
                  let convId = dict["conversationId"] as? String,
                  convId == conversationId,
                  let text = dict["text"] as? String,
                  let idx = streamingMessageIndex,
                  idx < messages.count else { return }
            // Replace struct at index (content is let)
            let current = messages[idx]
            messages[idx] = Message(
                uuid: current.uuid,
                role: current.role,
                content: current.content + text,
                timestamp: current.timestamp
            )

        case .assistantComplete:
            guard let dict = message.payload?.value as? [String: Any],
                  let convId = dict["conversationId"] as? String,
                  convId == conversationId else { return }
            chatState = .idle
            streamingMessageIndex = nil

        case .assistantError:
            let dict = message.payload?.value as? [String: Any]
            guard let convId = dict?["conversationId"] as? String,
                  convId == conversationId else { return }
            let errorMsg = dict?["error"] as? String ?? "Unknown error"
            chatState = .error(errorMsg)
            streamingMessageIndex = nil

        default:
            break
        }
    }
}

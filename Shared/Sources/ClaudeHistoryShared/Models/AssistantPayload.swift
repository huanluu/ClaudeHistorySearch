import Foundation

// MARK: - Assistant Payloads (match server gateway/protocol.ts)

/// Payload for assistant.message (client → server)
public struct AssistantMessagePayload: Codable, Sendable {
    public let conversationId: String
    public let text: String

    public init(conversationId: String, text: String) {
        self.conversationId = conversationId
        self.text = text
    }
}

/// Payload for assistant.cancel (client → server)
public struct AssistantCancelPayload: Codable, Sendable {
    public let conversationId: String

    public init(conversationId: String) {
        self.conversationId = conversationId
    }
}

/// Payload for assistant.delta (server → client)
public struct AssistantDeltaPayload: Codable, Sendable {
    public let conversationId: String
    public let text: String
}

/// Payload for assistant.complete (server → client)
public struct AssistantCompletePayload: Codable, Sendable {
    public let conversationId: String
}

/// Payload for assistant.error (server → client)
public struct AssistantErrorPayload: Codable, Sendable {
    public let conversationId: String
    public let error: String
    public let errorCode: String?
}

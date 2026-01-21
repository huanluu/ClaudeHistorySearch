import Foundation

struct Message: Identifiable, Codable, Hashable {
    let uuid: String
    let role: String
    let content: String
    let timestamp: Int64?
    var highlightedContent: String?

    var id: String { uuid }

    var isUser: Bool { role == "user" }
    var isAssistant: Bool { role == "assistant" }

    var timestampDate: Date? {
        guard let timestamp = timestamp else { return nil }
        return Date(timeIntervalSince1970: Double(timestamp) / 1000.0)
    }
}

struct SessionDetailResponse: Codable {
    let session: Session
    let messages: [Message]
}

struct SearchResult: Identifiable, Codable, Hashable {
    let sessionId: String
    let project: String
    let sessionStartedAt: Int64
    let message: Message

    var id: String { "\(sessionId)-\(message.uuid)" }

    var startedAtDate: Date {
        Date(timeIntervalSince1970: Double(sessionStartedAt) / 1000.0)
    }
}

struct SearchResponse: Codable {
    let results: [SearchResult]
    let pagination: Pagination
    let query: String
}

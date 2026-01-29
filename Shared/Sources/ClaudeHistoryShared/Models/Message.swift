import Foundation

public struct Message: Identifiable, Codable, Hashable, Sendable {
    public let uuid: String
    public let role: String
    public let content: String
    public let timestamp: Int64?
    public var highlightedContent: String?

    public var id: String { uuid }

    public var isUser: Bool { role == "user" }
    public var isAssistant: Bool { role == "assistant" }

    public var timestampDate: Date? {
        guard let timestamp = timestamp else { return nil }
        return Date(timeIntervalSince1970: Double(timestamp) / 1000.0)
    }

    public init(uuid: String, role: String, content: String, timestamp: Int64?, highlightedContent: String? = nil) {
        self.uuid = uuid
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.highlightedContent = highlightedContent
    }
}

public struct SessionDetailResponse: Codable, Sendable {
    public let session: Session
    public let messages: [Message]

    public init(session: Session, messages: [Message]) {
        self.session = session
        self.messages = messages
    }
}

public struct SearchResult: Identifiable, Codable, Hashable, Sendable {
    public let sessionId: String
    public let project: String
    public let sessionStartedAt: Int64
    public let title: String?
    public let message: Message

    public var id: String { "\(sessionId)-\(message.uuid)" }

    public var startedAtDate: Date {
        Date(timeIntervalSince1970: Double(sessionStartedAt) / 1000.0)
    }

    public var projectName: String {
        (project as NSString).lastPathComponent
    }

    /// Display name for the session - uses title if available, otherwise falls back to project name
    public var displayName: String {
        if let title = title, !title.isEmpty {
            return title
        }
        return projectName
    }

    public init(sessionId: String, project: String, sessionStartedAt: Int64, title: String? = nil, message: Message) {
        self.sessionId = sessionId
        self.project = project
        self.sessionStartedAt = sessionStartedAt
        self.title = title
        self.message = message
    }
}

public struct SearchResponse: Codable, Sendable {
    public let results: [SearchResult]
    public let pagination: Pagination
    public let query: String

    public init(results: [SearchResult], pagination: Pagination, query: String) {
        self.results = results
        self.pagination = pagination
        self.query = query
    }
}

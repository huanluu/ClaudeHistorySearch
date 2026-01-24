import Foundation

public struct Session: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let project: String
    public let startedAt: Int64
    public let messageCount: Int
    public let preview: String

    public init(id: String, project: String, startedAt: Int64, messageCount: Int, preview: String) {
        self.id = id
        self.project = project
        self.startedAt = startedAt
        self.messageCount = messageCount
        self.preview = preview
    }

    public var startedAtDate: Date {
        Date(timeIntervalSince1970: Double(startedAt) / 1000.0)
    }

    public var projectName: String {
        (project as NSString).lastPathComponent
    }
}

public struct SessionsResponse: Codable, Sendable {
    public let sessions: [Session]
    public let pagination: Pagination

    public init(sessions: [Session], pagination: Pagination) {
        self.sessions = sessions
        self.pagination = pagination
    }
}

public struct Pagination: Codable, Sendable {
    public let limit: Int
    public let offset: Int
    public let hasMore: Bool

    public init(limit: Int, offset: Int, hasMore: Bool) {
        self.limit = limit
        self.offset = offset
        self.hasMore = hasMore
    }
}

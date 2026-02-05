import Foundation

public struct Session: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let project: String
    public let startedAt: Int64
    public let messageCount: Int
    public let preview: String
    public let title: String?
    public let isAutomatic: Bool?
    public let isUnread: Bool?

    public init(id: String, project: String, startedAt: Int64, messageCount: Int, preview: String, title: String? = nil, isAutomatic: Bool? = nil, isUnread: Bool? = nil) {
        self.id = id
        self.project = project
        self.startedAt = startedAt
        self.messageCount = messageCount
        self.preview = preview
        self.title = title
        self.isAutomatic = isAutomatic
        self.isUnread = isUnread
    }

    public var startedAtDate: Date {
        Date(timeIntervalSince1970: Double(startedAt) / 1000.0)
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

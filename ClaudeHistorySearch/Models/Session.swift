import Foundation

struct Session: Identifiable, Codable, Hashable {
    let id: String
    let project: String
    let startedAt: Int64
    let messageCount: Int
    let preview: String

    var startedAtDate: Date {
        Date(timeIntervalSince1970: Double(startedAt) / 1000.0)
    }

    var projectName: String {
        // Extract last component of path
        (project as NSString).lastPathComponent
    }
}

struct SessionsResponse: Codable {
    let sessions: [Session]
    let pagination: Pagination
}

struct Pagination: Codable {
    let limit: Int
    let offset: Int
    let hasMore: Bool
}

import Foundation

/// Protocol defining network operations for Claude History Search
///
/// This protocol abstracts the network layer, allowing different implementations
/// such as HTTP (REST API) or WebSocket for real-time communication.
/// The protocol is designed to be used with async/await and is MainActor-isolated
/// for safe UI updates.
@MainActor
public protocol NetworkService: AnyObject {
    /// Current connection state
    var isConnected: Bool { get }

    /// Whether the client has valid authentication
    var isAuthenticated: Bool { get }

    /// Error state (if any)
    var error: String? { get }

    /// Configure the server URL
    func setBaseURL(_ url: URL?)

    /// Get the current server URL
    func getBaseURL() -> URL?

    /// Configure the API key for authentication
    func setAPIKey(_ key: String?)

    /// Get the current API key
    func getAPIKey() -> String?

    // MARK: - Session Operations

    /// Fetch a paginated list of sessions
    /// - Parameters:
    ///   - limit: Maximum number of sessions to return (default: 20)
    ///   - offset: Number of sessions to skip (default: 0)
    ///   - automatic: Filter by automatic status (nil = all, true = heartbeat only, false = manual only)
    /// - Returns: Sessions response with pagination info
    func fetchSessions(limit: Int, offset: Int, automatic: Bool?) async throws -> SessionsResponse

    /// Fetch a single session with all its messages
    /// - Parameter id: The session ID
    /// - Returns: Session detail response with messages
    func fetchSession(id: String) async throws -> SessionDetailResponse

    // MARK: - Search Operations

    /// Search across all sessions
    /// - Parameters:
    ///   - query: Search query string
    ///   - limit: Maximum number of results (default: 50)
    ///   - offset: Number of results to skip (default: 0)
    ///   - sort: Sort order (relevance or date)
    ///   - automatic: Filter by automatic status (nil = all, true = heartbeat only, false = manual only)
    /// - Returns: Search response with results and pagination
    func search(query: String, limit: Int, offset: Int, sort: SearchSortOption, automatic: Bool?) async throws -> SearchResponse

    // MARK: - Session Actions

    /// Delete (hide) a session
    /// - Parameter id: The session ID to delete
    func deleteSession(id: String) async throws

    // MARK: - Health Check

    /// Check if the server is healthy and reachable
    /// - Returns: true if server responds with 200 OK
    func checkHealth() async throws -> Bool
}

/// Default parameter values for NetworkService methods
public extension NetworkService {
    func fetchSessions() async throws -> SessionsResponse {
        try await fetchSessions(limit: 20, offset: 0, automatic: nil)
    }

    func fetchSessions(limit: Int, offset: Int) async throws -> SessionsResponse {
        try await fetchSessions(limit: limit, offset: offset, automatic: nil)
    }

    func search(query: String, sort: SearchSortOption = .relevance) async throws -> SearchResponse {
        try await search(query: query, limit: 50, offset: 0, sort: sort, automatic: nil)
    }

    func search(query: String, limit: Int, offset: Int, sort: SearchSortOption) async throws -> SearchResponse {
        try await search(query: query, limit: limit, offset: offset, sort: sort, automatic: nil)
    }
}

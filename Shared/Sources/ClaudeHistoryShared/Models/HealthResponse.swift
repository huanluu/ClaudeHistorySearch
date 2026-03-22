import Foundation

/// Typed model for the server's `/health` endpoint response.
/// Matches the server's `HealthResult` contract exactly: status is `healthy` or `degraded`.
public struct HealthResponse: Decodable, Sendable {
    public enum Status: String, Decodable, Sendable {
        case healthy
        case degraded
    }

    public let status: Status
    public let timestamp: String

    /// Whether the server is reachable for cached URL verification.
    /// Both `healthy` and `degraded` mean the server is up (degraded = DB issue, server still running).
    public var isReachable: Bool {
        switch status {
        case .healthy, .degraded:
            return true
        }
    }
}

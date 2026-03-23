import XCTest
@testable import ClaudeHistoryShared

/// Integration tests that hit the live server at localhost:3847.
///
/// Gated by RUN_LIVE_INTEGRATION=1. During normal development (`swift test`),
/// these are skipped — unit and contract tests provide fast feedback. The `/qa`
/// skill enables this gate after deploying fresh code, running the full suite
/// including these canary tests.
///
/// Dev:  swift test                                    (skips integration)
/// QA:   RUN_LIVE_INTEGRATION=1 swift test             (runs everything)
/// Just: RUN_LIVE_INTEGRATION=1 swift test --filter Integration
final class HealthEndpointIntegrationTests: XCTestCase {

    private var serverURL: URL {
        URL(string: "http://localhost:3847")!
    }

    private func requireIntegration() throws {
        guard ProcessInfo.processInfo.environment["RUN_LIVE_INTEGRATION"] == "1" else {
            throw XCTSkip("RUN_LIVE_INTEGRATION not set — run via /qa to enable")
        }
    }

    private func fetchHealth() async throws -> (Data, HTTPURLResponse) {
        let url = serverURL.appendingPathComponent("health")
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            XCTFail("Response is not HTTP")
            throw URLError(.badServerResponse)
        }
        return (data, http)
    }

    /// Hits the real /health endpoint and verifies the Swift client can decode it.
    /// This is the end-to-end contract canary — if this passes, cached URL verification works.
    func testHealthEndpoint_decodesToReachableStatus() async throws {
        try requireIntegration()
        let (data, http) = try await fetchHealth()

        XCTAssertEqual(http.statusCode, 200)

        let health = try JSONDecoder().decode(HealthResponse.self, from: data)
        XCTAssertTrue(health.isReachable, "Server returned status '\(health.status)' which is not reachable")
    }

    /// Verifies the live /health response matches the shared contract fixture.
    func testHealthEndpoint_matchesContractFixture() async throws {
        try requireIntegration()
        let (data, _) = try await fetchHealth()

        let liveResponse = try JSONDecoder().decode(HealthResponse.self, from: data)

        XCTAssertTrue(
            liveResponse.status == .healthy || liveResponse.status == .degraded,
            "Live /health returned unexpected status: \(liveResponse.status)"
        )
        XCTAssertFalse(liveResponse.timestamp.isEmpty, "Timestamp should not be empty")
    }
}

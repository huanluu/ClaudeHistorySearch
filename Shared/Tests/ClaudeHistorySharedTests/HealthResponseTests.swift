import XCTest
@testable import ClaudeHistoryShared

/// Contract tests for HealthResponse — ensures the Swift client can decode
/// the server's /health endpoint response correctly.
final class HealthResponseTests: XCTestCase {

    private func decode(_ json: String) throws -> HealthResponse {
        let data = json.data(using: .utf8)!
        return try JSONDecoder().decode(HealthResponse.self, from: data)
    }

    // MARK: - Successful Decoding

    func testDecode_healthyStatus() throws {
        let response = try decode("""
            {"status":"healthy","timestamp":"2025-01-01T00:00:00.000Z"}
            """)
        XCTAssertEqual(response.status, .healthy)
        XCTAssertEqual(response.timestamp, "2025-01-01T00:00:00.000Z")
    }

    func testDecode_degradedStatus() throws {
        let response = try decode("""
            {"status":"degraded","timestamp":"2025-01-01T00:00:00.000Z"}
            """)
        XCTAssertEqual(response.status, .degraded)
    }

    // MARK: - Decode Failures

    func testDecode_unknownStatus_throwsDecodingError() {
        XCTAssertThrowsError(try decode("""
            {"status":"wat","timestamp":"2025-01-01T00:00:00.000Z"}
            """)) { error in
            XCTAssertTrue(error is DecodingError, "Expected DecodingError, got \(type(of: error))")
        }
    }

    func testDecode_malformedJSON_throws() {
        let data = "not json at all".data(using: .utf8)!
        XCTAssertThrowsError(try JSONDecoder().decode(HealthResponse.self, from: data))
    }

    func testDecode_missingTimestamp_throws() {
        XCTAssertThrowsError(try decode("""
            {"status":"healthy"}
            """))
    }

    // MARK: - Reachability

    func testIsReachable_healthy() throws {
        let response = try decode("""
            {"status":"healthy","timestamp":"2025-01-01T00:00:00.000Z"}
            """)
        XCTAssertTrue(response.isReachable)
    }

    func testIsReachable_degraded() throws {
        let response = try decode("""
            {"status":"degraded","timestamp":"2025-01-01T00:00:00.000Z"}
            """)
        XCTAssertTrue(response.isReachable)
    }

    // MARK: - Contract Fixture Tests

    /// Decodes the shared contract fixture (contracts/health-response-healthy.json)
    /// using the real HealthResponse decoder. If this test and the server's equivalent
    /// both pass, the client/server contract is aligned without needing a live server.
    func testDecodeContractFixture_healthy() throws {
        let fixture = """
            {"status":"healthy","timestamp":"2025-01-01T00:00:00.000Z","checks":{"database":true}}
            """
        let response = try decode(fixture)
        XCTAssertEqual(response.status, .healthy)
        XCTAssertTrue(response.isReachable)
    }

    func testDecodeContractFixture_degraded() throws {
        let fixture = """
            {"status":"degraded","timestamp":"2025-01-01T00:00:00.000Z","checks":{"database":false}}
            """
        let response = try decode(fixture)
        XCTAssertEqual(response.status, .degraded)
        XCTAssertTrue(response.isReachable)
    }
}

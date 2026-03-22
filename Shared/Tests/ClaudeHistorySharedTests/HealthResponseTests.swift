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
}

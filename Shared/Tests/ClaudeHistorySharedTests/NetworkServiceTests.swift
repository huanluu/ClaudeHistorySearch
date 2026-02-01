import XCTest
@testable import ClaudeHistoryShared

/// Tests for NetworkService protocol and APIClient conformance
/// Verifies that:
/// - APIClient properly conforms to NetworkService
/// - Protocol methods have correct signatures
/// - Default parameter values work correctly
final class NetworkServiceTests: XCTestCase {

    // MARK: - Protocol Conformance Tests

    @MainActor
    func testAPIClientConformsToNetworkService() {
        // This test verifies at compile-time that APIClient conforms to NetworkService
        let client = APIClient()
        let _: NetworkService = client // Should compile without error

        // The fact that this compiles proves conformance
        XCTAssertTrue(true)
    }

    @MainActor
    func testNetworkServiceCanBeUsedAsProtocolType() {
        // Verify we can use APIClient where NetworkService is expected
        func acceptsNetworkService(_ service: NetworkService) -> Bool {
            return service.isConnected || !service.isConnected // Always true
        }

        let client = APIClient()
        XCTAssertTrue(acceptsNetworkService(client))
    }

    // MARK: - isConnected Property Tests

    @MainActor
    func testIsConnectedFalseWhenNoBaseURL() {
        let client = APIClient()
        XCTAssertFalse(client.isConnected)
    }

    @MainActor
    func testIsConnectedTrueWhenBaseURLSet() {
        let client = APIClient()
        client.setBaseURL(URL(string: "http://localhost:3847")!)
        XCTAssertTrue(client.isConnected)
    }

    @MainActor
    func testIsConnectedFalseAfterClearingBaseURL() {
        let client = APIClient()
        client.setBaseURL(URL(string: "http://localhost:3847")!)
        XCTAssertTrue(client.isConnected)

        client.setBaseURL(nil)
        XCTAssertFalse(client.isConnected)
    }

    // MARK: - isAuthenticated Property Tests

    @MainActor
    func testIsAuthenticatedDefaultsToTrue() {
        let client = APIClient()
        XCTAssertTrue(client.isAuthenticated)
    }

    @MainActor
    func testIsAuthenticatedAfterSettingAPIKey() {
        let client = APIClient()
        client.setAPIKey("test-key")
        XCTAssertTrue(client.isAuthenticated)
    }

    // MARK: - error Property Tests

    @MainActor
    func testErrorDefaultsToNil() {
        let client = APIClient()
        XCTAssertNil(client.error)
    }

    // MARK: - Protocol Method Signatures

    @MainActor
    func testSetBaseURLSignature() {
        let client = APIClient()
        let service: NetworkService = client

        // Test that setBaseURL accepts URL?
        service.setBaseURL(URL(string: "http://localhost:3847")!)
        service.setBaseURL(nil)

        // Should compile and run without error
        XCTAssertTrue(true)
    }

    @MainActor
    func testGetBaseURLSignature() {
        let client = APIClient()
        let service: NetworkService = client

        // Test that getBaseURL returns URL?
        let url: URL? = service.getBaseURL()
        XCTAssertNil(url)

        service.setBaseURL(URL(string: "http://localhost:3847")!)
        let url2: URL? = service.getBaseURL()
        XCTAssertNotNil(url2)
    }

    @MainActor
    func testSetAPIKeySignature() {
        let client = APIClient()
        let service: NetworkService = client

        // Test that setAPIKey accepts String?
        service.setAPIKey("test-key")
        service.setAPIKey(nil)

        XCTAssertTrue(true)
    }

    @MainActor
    func testGetAPIKeySignature() {
        let client = APIClient()
        let service: NetworkService = client

        // Test that getAPIKey returns String?
        let key: String? = service.getAPIKey()
        XCTAssertNil(key)

        service.setAPIKey("test-key")
        let key2: String? = service.getAPIKey()
        XCTAssertEqual(key2, "test-key")
    }

    // MARK: - Async Method Signature Tests

    @MainActor
    func testFetchSessionsThrowsNoServerError() async {
        let client = APIClient()
        let service: NetworkService = client

        // Verify fetchSessions throws when no server configured
        do {
            _ = try await service.fetchSessions(limit: 20, offset: 0)
            XCTFail("Should throw noServer error")
        } catch {
            // Expected - no server URL configured
            XCTAssertTrue(error is APIError)
        }
    }

    @MainActor
    func testFetchSessionThrowsNoServerError() async {
        let client = APIClient()
        let service: NetworkService = client

        do {
            _ = try await service.fetchSession(id: "test-id")
            XCTFail("Should throw noServer error")
        } catch {
            XCTAssertTrue(error is APIError)
        }
    }

    @MainActor
    func testSearchThrowsNoServerError() async {
        let client = APIClient()
        let service: NetworkService = client

        do {
            _ = try await service.search(query: "test", limit: 50, offset: 0, sort: .relevance)
            XCTFail("Should throw noServer error")
        } catch {
            XCTAssertTrue(error is APIError)
        }
    }

    @MainActor
    func testCheckHealthThrowsNoServerError() async {
        let client = APIClient()
        let service: NetworkService = client

        do {
            _ = try await service.checkHealth()
            XCTFail("Should throw noServer error")
        } catch {
            XCTAssertTrue(error is APIError)
        }
    }

    // MARK: - Default Parameter Tests

    @MainActor
    func testFetchSessionsDefaultParameters() async {
        let client = APIClient()
        client.setBaseURL(URL(string: "http://localhost:9999")!) // Non-existent server

        // This verifies default parameters work (limit: 20, offset: 0)
        // It will fail to connect, but that's expected
        do {
            _ = try await client.fetchSessions() // Using defaults
            XCTFail("Should fail to connect")
        } catch {
            // Expected - server doesn't exist
            // The important thing is that the call compiles with defaults
            XCTAssertTrue(true)
        }
    }

    @MainActor
    func testSearchDefaultParameters() async {
        let client = APIClient()
        client.setBaseURL(URL(string: "http://localhost:9999")!)

        // This verifies default parameters work (limit: 50, offset: 0, sort: .relevance)
        do {
            _ = try await client.search(query: "test") // Using defaults for limit, offset, sort
            XCTFail("Should fail to connect")
        } catch {
            XCTAssertTrue(true)
        }
    }

    // MARK: - Protocol as Dependency Injection

    @MainActor
    func testNetworkServiceCanBeInjected() {
        // Simulate a view model that accepts NetworkService
        @MainActor
        class MockViewModel {
            let networkService: NetworkService

            init(networkService: NetworkService) {
                self.networkService = networkService
            }

            var isConnected: Bool {
                networkService.isConnected
            }
        }

        let client = APIClient()
        client.setBaseURL(URL(string: "http://localhost:3847")!)

        let viewModel = MockViewModel(networkService: client)
        XCTAssertTrue(viewModel.isConnected)
    }
}

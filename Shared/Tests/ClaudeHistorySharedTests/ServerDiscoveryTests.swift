import XCTest
@testable import ClaudeHistoryShared

/// Tests for ServerDiscovery focusing on:
/// - Cached URL initialization
/// - Connection status states
/// - Manual URL setting
final class ServerDiscoveryTests: XCTestCase {

    override func setUp() {
        super.setUp()
        // Clear cached URL before each test to ensure isolation
        UserDefaults.standard.removeObject(forKey: "cachedServerURL")
    }

    override func tearDown() {
        // Clean up after tests
        UserDefaults.standard.removeObject(forKey: "cachedServerURL")
        super.tearDown()
    }

    // MARK: - Initialization Tests

    @MainActor
    func testInitialStateWithNoCache() {
        let discovery = ServerDiscovery()

        XCTAssertNil(discovery.serverURL)
        XCTAssertFalse(discovery.isSearching)
        XCTAssertEqual(discovery.connectionStatus, .disconnected)
    }

    @MainActor
    func testInitialStateWithValidCachedURL() {
        // Set up a valid cached URL
        let cachedURLString = "http://192.168.1.100:3847"
        UserDefaults.standard.set(cachedURLString, forKey: "cachedServerURL")

        let discovery = ServerDiscovery()

        // Verify cached URL is restored
        XCTAssertNotNil(discovery.serverURL)
        XCTAssertEqual(discovery.serverURL?.absoluteString, cachedURLString)
        XCTAssertEqual(discovery.connectionStatus, .connected("192.168.1.100"))
    }

    @MainActor
    func testInitialStateWithInvalidCachedURL() {
        // Set up an empty cached URL string (truly invalid - URL(string:"") returns nil)
        UserDefaults.standard.set("", forKey: "cachedServerURL")

        let discovery = ServerDiscovery()

        // Empty string URL should result in disconnected state
        XCTAssertNil(discovery.serverURL)
        XCTAssertEqual(discovery.connectionStatus, .disconnected)
    }

    // MARK: - Manual URL Tests

    @MainActor
    func testSetManualURLWithValidURL() {
        let discovery = ServerDiscovery()

        discovery.setManualURL("http://localhost:3847")

        XCTAssertEqual(discovery.serverURL?.absoluteString, "http://localhost:3847")
        XCTAssertEqual(discovery.connectionStatus, .connected("localhost"))
    }

    @MainActor
    func testSetManualURLWithoutScheme() {
        let discovery = ServerDiscovery()

        // Should auto-add http://
        discovery.setManualURL("192.168.1.50:3847")

        XCTAssertEqual(discovery.serverURL?.absoluteString, "http://192.168.1.50:3847")
        XCTAssertEqual(discovery.connectionStatus, .connected("192.168.1.50"))
    }

    @MainActor
    func testSetManualURLWithInvalidURL() {
        let discovery = ServerDiscovery()

        // Invalid URL characters should result in error
        discovery.setManualURL("http://[invalid")

        XCTAssertNil(discovery.serverURL)
        if case .error(let message) = discovery.connectionStatus {
            XCTAssertEqual(message, "Invalid URL")
        } else {
            XCTFail("Expected error status")
        }
    }

    @MainActor
    func testSetManualURLPersistsToCache() {
        let discovery = ServerDiscovery()

        discovery.setManualURL("http://10.0.0.5:3847")

        // Verify it was cached
        let cached = UserDefaults.standard.string(forKey: "cachedServerURL")
        XCTAssertEqual(cached, "http://10.0.0.5:3847")
    }

    // MARK: - Disconnect Tests

    @MainActor
    func testDisconnect() {
        let discovery = ServerDiscovery()
        discovery.setManualURL("http://localhost:3847")

        // Verify connected first
        XCTAssertNotNil(discovery.serverURL)

        discovery.disconnect()

        XCTAssertNil(discovery.serverURL)
        XCTAssertEqual(discovery.connectionStatus, .disconnected)

        // Verify cache was cleared
        let cached = UserDefaults.standard.string(forKey: "cachedServerURL")
        XCTAssertNil(cached)
    }

    // MARK: - ConnectionStatus Tests

    @MainActor
    func testConnectionStatusDescriptions() {
        XCTAssertEqual(ServerDiscovery.ConnectionStatus.disconnected.description, "Disconnected")
        XCTAssertEqual(ServerDiscovery.ConnectionStatus.searching.description, "Searching...")
        XCTAssertEqual(ServerDiscovery.ConnectionStatus.connected("localhost").description, "Connected to localhost")
        XCTAssertEqual(ServerDiscovery.ConnectionStatus.error("Test error").description, "Error: Test error")
    }

    @MainActor
    func testConnectionStatusIsConnected() {
        XCTAssertFalse(ServerDiscovery.ConnectionStatus.disconnected.isConnected)
        XCTAssertFalse(ServerDiscovery.ConnectionStatus.searching.isConnected)
        XCTAssertTrue(ServerDiscovery.ConnectionStatus.connected("host").isConnected)
        XCTAssertFalse(ServerDiscovery.ConnectionStatus.error("err").isConnected)
    }

    // MARK: - Searching State Tests

    @MainActor
    func testStartSearchingSetsState() {
        let discovery = ServerDiscovery()

        discovery.startSearching()

        XCTAssertTrue(discovery.isSearching)
        XCTAssertEqual(discovery.connectionStatus, .searching)

        // Clean up
        discovery.stopSearching()
    }

    @MainActor
    func testStopSearchingResetsState() {
        let discovery = ServerDiscovery()
        discovery.startSearching()

        discovery.stopSearching()

        XCTAssertFalse(discovery.isSearching)
    }

    @MainActor
    func testStartSearchingIsIdempotent() {
        let discovery = ServerDiscovery()

        // Calling start multiple times shouldn't create multiple browsers
        discovery.startSearching()
        discovery.startSearching()
        discovery.startSearching()

        // Should still be searching (not crashed)
        XCTAssertTrue(discovery.isSearching)

        discovery.stopSearching()
    }
}

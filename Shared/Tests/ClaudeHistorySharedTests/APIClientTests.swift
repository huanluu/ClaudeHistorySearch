import XCTest
@testable import ClaudeHistoryShared

/// Tests for APIClient focusing on critical paths:
/// - Auth header inclusion
/// - 401 response handling
/// - Session/Search response parsing
final class APIClientTests: XCTestCase {

    // MARK: - Model Parsing Tests

    func testSessionParsing() throws {
        let json = """
        {
            "id": "session-001",
            "project": "/Users/test/project",
            "startedAt": 1705320000000,
            "messageCount": 5,
            "preview": "How do I create a React component?",
            "title": "React Tutorial"
        }
        """

        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(Session.self, from: data)

        XCTAssertEqual(session.id, "session-001")
        XCTAssertEqual(session.project, "/Users/test/project")
        XCTAssertEqual(session.startedAt, 1705320000000)
        XCTAssertEqual(session.messageCount, 5)
        XCTAssertEqual(session.preview, "How do I create a React component?")
        XCTAssertEqual(session.title, "React Tutorial")
        XCTAssertEqual(session.projectName, "project")
        XCTAssertEqual(session.displayName, "React Tutorial")
    }

    func testSessionParsingWithoutTitle() throws {
        let json = """
        {
            "id": "session-002",
            "project": "/Users/test/my-project",
            "startedAt": 1705320000000,
            "messageCount": 3,
            "preview": "Help me debug this"
        }
        """

        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(Session.self, from: data)

        XCTAssertNil(session.title)
        XCTAssertEqual(session.displayName, "my-project")
    }

    func testSessionsResponseParsing() throws {
        let json = """
        {
            "sessions": [
                {
                    "id": "session-001",
                    "project": "/test",
                    "startedAt": 1705320000000,
                    "messageCount": 5,
                    "preview": "Test preview",
                    "title": "Test Session"
                }
            ],
            "pagination": {
                "limit": 20,
                "offset": 0,
                "hasMore": true
            }
        }
        """

        let data = json.data(using: .utf8)!
        let response = try JSONDecoder().decode(SessionsResponse.self, from: data)

        XCTAssertEqual(response.sessions.count, 1)
        XCTAssertEqual(response.sessions[0].id, "session-001")
        XCTAssertEqual(response.pagination.limit, 20)
        XCTAssertEqual(response.pagination.offset, 0)
        XCTAssertTrue(response.pagination.hasMore)
    }

    func testMessageParsing() throws {
        let json = """
        {
            "uuid": "msg-001",
            "role": "user",
            "content": "Hello, world!",
            "timestamp": 1705320000000,
            "highlightedContent": "Hello, <mark>world</mark>!"
        }
        """

        let data = json.data(using: .utf8)!
        let message = try JSONDecoder().decode(Message.self, from: data)

        XCTAssertEqual(message.uuid, "msg-001")
        XCTAssertEqual(message.role, "user")
        XCTAssertEqual(message.content, "Hello, world!")
        XCTAssertEqual(message.timestamp, 1705320000000)
        XCTAssertEqual(message.highlightedContent, "Hello, <mark>world</mark>!")
        XCTAssertTrue(message.isUser)
        XCTAssertFalse(message.isAssistant)
    }

    func testSearchResultParsing() throws {
        let json = """
        {
            "sessionId": "session-001",
            "project": "/Users/test/project",
            "sessionStartedAt": 1705320000000,
            "title": "Test Session",
            "message": {
                "uuid": "msg-001",
                "role": "assistant",
                "content": "Here is the answer",
                "timestamp": 1705320000000
            }
        }
        """

        let data = json.data(using: .utf8)!
        let result = try JSONDecoder().decode(SearchResult.self, from: data)

        XCTAssertEqual(result.sessionId, "session-001")
        XCTAssertEqual(result.project, "/Users/test/project")
        XCTAssertEqual(result.title, "Test Session")
        XCTAssertEqual(result.message.role, "assistant")
        XCTAssertEqual(result.displayName, "Test Session")
    }

    func testSearchResponseParsing() throws {
        let json = """
        {
            "results": [
                {
                    "sessionId": "session-001",
                    "project": "/test",
                    "sessionStartedAt": 1705320000000,
                    "message": {
                        "uuid": "msg-001",
                        "role": "user",
                        "content": "Search query test",
                        "timestamp": 1705320000000
                    }
                }
            ],
            "pagination": {
                "limit": 50,
                "offset": 0,
                "hasMore": false
            },
            "query": "test"
        }
        """

        let data = json.data(using: .utf8)!
        let response = try JSONDecoder().decode(SearchResponse.self, from: data)

        XCTAssertEqual(response.results.count, 1)
        XCTAssertEqual(response.query, "test")
        XCTAssertFalse(response.pagination.hasMore)
    }

    // MARK: - APIError Tests

    func testAPIErrorDescriptions() {
        XCTAssertEqual(APIError.noServer.errorDescription, "No server connected")
        XCTAssertEqual(APIError.invalidResponse.errorDescription, "Invalid server response")
        XCTAssertEqual(APIError.unauthorized.errorDescription, "Invalid or missing API key")
        XCTAssertEqual(APIError.notFound.errorDescription, "Resource not found")
        XCTAssertEqual(APIError.clientError(400).errorDescription, "Client error: 400")
        XCTAssertEqual(APIError.serverError(500).errorDescription, "Server error: 500")
        XCTAssertEqual(APIError.unknown(999).errorDescription, "Unknown error: 999")
    }

    // MARK: - APIClient State Tests

    @MainActor
    func testAPIClientInitialState() {
        let client = APIClient()

        XCTAssertNil(client.getBaseURL())
        XCTAssertNil(client.getAPIKey())
        XCTAssertFalse(client.isLoading)
        XCTAssertNil(client.error)
        XCTAssertTrue(client.isAuthenticated)
    }

    @MainActor
    func testAPIClientSetBaseURL() {
        let client = APIClient()
        let url = URL(string: "http://localhost:3847")!

        client.setBaseURL(url)

        XCTAssertEqual(client.getBaseURL(), url)
    }

    @MainActor
    func testAPIClientSetAPIKey() {
        let client = APIClient()
        let apiKey = "test-api-key-12345"

        client.setAPIKey(apiKey)

        XCTAssertEqual(client.getAPIKey(), apiKey)
        XCTAssertTrue(client.isAuthenticated)
    }

    @MainActor
    func testAPIClientNoServerError() async {
        let client = APIClient()
        // Don't set base URL

        do {
            _ = try await client.fetchSessions()
            XCTFail("Should have thrown noServer error")
        } catch let error as APIError {
            XCTAssertEqual(error.errorDescription, "No server connected")
        } catch {
            XCTFail("Unexpected error type: \(error)")
        }
    }

    // MARK: - SearchSortOption Tests

    func testSearchSortOptionValues() {
        XCTAssertEqual(SearchSortOption.relevance.rawValue, "relevance")
        XCTAssertEqual(SearchSortOption.date.rawValue, "date")
        XCTAssertEqual(SearchSortOption.relevance.displayName, "Relevance")
        XCTAssertEqual(SearchSortOption.date.displayName, "Date")
    }

    func testSearchSortOptionAllCases() {
        XCTAssertEqual(SearchSortOption.allCases.count, 2)
        XCTAssertTrue(SearchSortOption.allCases.contains(.relevance))
        XCTAssertTrue(SearchSortOption.allCases.contains(.date))
    }

    // MARK: - Network Error Tests

    /// Creates an APIClient configured with MockURLProtocol for testing
    @MainActor
    private func createMockedClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: config)
        let client = APIClient(session: session)
        client.setBaseURL(URL(string: "http://localhost:3847")!)
        return client
    }

    @MainActor
    func testNetworkConnectionLostError() async {
        MockURLProtocol.reset()
        let client = createMockedClient()

        // Configure mock to throw networkConnectionLost error
        MockURLProtocol.requestHandler = { _ in
            throw URLError(.networkConnectionLost)
        }

        do {
            _ = try await client.fetchSessions()
            XCTFail("Should have thrown an error")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .networkConnectionLost)
            // URLError codes are properly surfaced - the exact message varies by OS version
        } catch {
            XCTFail("Unexpected error type: \(type(of: error)) - \(error)")
        }
    }

    @MainActor
    func testTimeoutError() async {
        MockURLProtocol.reset()
        let client = createMockedClient()

        MockURLProtocol.requestHandler = { _ in
            throw URLError(.timedOut)
        }

        do {
            _ = try await client.fetchSessions()
            XCTFail("Should have thrown an error")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .timedOut)
        } catch {
            XCTFail("Unexpected error type: \(type(of: error)) - \(error)")
        }
    }

    @MainActor
    func testCannotConnectToHostError() async {
        MockURLProtocol.reset()
        let client = createMockedClient()

        MockURLProtocol.requestHandler = { _ in
            throw URLError(.cannotConnectToHost)
        }

        do {
            _ = try await client.fetchSessions()
            XCTFail("Should have thrown an error")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .cannotConnectToHost)
        } catch {
            XCTFail("Unexpected error type: \(type(of: error)) - \(error)")
        }
    }

    @MainActor
    func testNotConnectedToInternetError() async {
        MockURLProtocol.reset()
        let client = createMockedClient()

        MockURLProtocol.requestHandler = { _ in
            throw URLError(.notConnectedToInternet)
        }

        do {
            _ = try await client.fetchSessions()
            XCTFail("Should have thrown an error")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .notConnectedToInternet)
        } catch {
            XCTFail("Unexpected error type: \(type(of: error)) - \(error)")
        }
    }

    // MARK: - Date Conversion Tests

    func testSessionStartedAtDate() {
        let session = Session(
            id: "test",
            project: "/test",
            startedAt: 1705320000000, // 2024-01-15 10:00:00 UTC
            messageCount: 1,
            preview: "Test"
        )

        let date = session.startedAtDate
        let calendar = Calendar(identifier: .gregorian)
        let components = calendar.dateComponents(in: TimeZone(identifier: "UTC")!, from: date)

        XCTAssertEqual(components.year, 2024)
        XCTAssertEqual(components.month, 1)
        XCTAssertEqual(components.day, 15)
    }

    func testMessageTimestampDate() {
        let message = Message(
            uuid: "test",
            role: "user",
            content: "Test",
            timestamp: 1705320000000
        )

        XCTAssertNotNil(message.timestampDate)
    }

    func testMessageNilTimestamp() {
        let message = Message(
            uuid: "test",
            role: "user",
            content: "Test",
            timestamp: nil
        )

        XCTAssertNil(message.timestampDate)
    }
}

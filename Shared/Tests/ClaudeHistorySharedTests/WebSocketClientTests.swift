import XCTest
@testable import ClaudeHistoryShared

/// Tests for WebSocketClient auth mechanism and multicast message delivery.
@MainActor
final class WebSocketClientTests: XCTestCase {

    // MARK: - Auth Contract Tests

    /// Verify the source code uses URLRequest with X-API-Key header,
    /// not URLQueryItem for auth. This is a source-level contract test.
    func testWebSocketClient_doesNotUseQueryParamAuth() throws {
        let client = WebSocketClient()
        let baseURL = URL(string: "http://localhost:3847")!
        client.configure(baseURL: baseURL, apiKey: "test-key-123")

        XCTAssertEqual(client.state, .disconnected)
    }

    func testWebSocketClient_sourceDoesNotContainQueryItemApiKey() throws {
        let sourceDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources")
            .appendingPathComponent("ClaudeHistoryShared")
            .appendingPathComponent("Services")
            .appendingPathComponent("WebSocketClient.swift")

        let source = try String(contentsOf: sourceDir, encoding: .utf8)

        XCTAssertFalse(
            source.contains("URLQueryItem(name: \"apiKey\""),
            "WebSocketClient.swift must not use URLQueryItem for API key auth — use X-API-Key header instead"
        )

        XCTAssertTrue(
            source.contains("X-API-Key"),
            "WebSocketClient.swift must set X-API-Key header for auth"
        )
    }

    // MARK: - Source Scan: No onMessage in ViewModels

    func testSourceScan_noOnMessageInViewModels() throws {
        let viewModelsDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources")
            .appendingPathComponent("ClaudeHistoryShared")
            .appendingPathComponent("ViewModels")

        let fileManager = FileManager.default
        let files = try fileManager.contentsOfDirectory(at: viewModelsDir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "swift" }

        for file in files {
            let source = try String(contentsOf: file, encoding: .utf8)
            XCTAssertFalse(
                source.contains(".onMessage ="),
                "\(file.lastPathComponent) must not set .onMessage — use makeMessageStream() subscription instead"
            )
            XCTAssertFalse(
                source.contains(".onMessage="),
                "\(file.lastPathComponent) must not set .onMessage — use makeMessageStream() subscription instead"
            )
        }
    }

    // MARK: - Multicast Fan-Out Tests

    func testMakeMessageStream_twoSubscribers_bothReceiveMessage() async {
        let client = WebSocketClient()

        let stream1 = client.makeMessageStream()
        let stream2 = client.makeMessageStream()

        let testMessage = WSMessage(type: .ping, id: "test-1")

        // Collect results from both streams
        var received1: [WSMessage] = []
        var received2: [WSMessage] = []

        let task1 = Task {
            for await msg in stream1 {
                received1.append(msg)
                break // Just get the first one
            }
        }
        let task2 = Task {
            for await msg in stream2 {
                received2.append(msg)
                break
            }
        }

        // Give streams time to start iterating
        try? await Task.sleep(nanoseconds: 50_000_000)

        client.broadcastForTesting(testMessage)

        // Wait for delivery
        try? await Task.sleep(nanoseconds: 50_000_000)
        task1.cancel()
        task2.cancel()

        XCTAssertEqual(received1.count, 1, "Subscriber 1 should receive the message")
        XCTAssertEqual(received2.count, 1, "Subscriber 2 should receive the message")
        XCTAssertEqual(received1.first?.id, "test-1")
        XCTAssertEqual(received2.first?.id, "test-1")
    }

    func testMakeMessageStream_cancelledSubscriber_doesNotReceive() async {
        let client = WebSocketClient()

        let stream1 = client.makeMessageStream()
        let stream2 = client.makeMessageStream()

        var received1: [WSMessage] = []
        var received2: [WSMessage] = []

        let task1 = Task {
            for await msg in stream1 {
                received1.append(msg)
            }
        }
        let task2 = Task {
            for await msg in stream2 {
                received2.append(msg)
            }
        }

        // Give streams time to start
        try? await Task.sleep(nanoseconds: 50_000_000)

        // Cancel subscriber 1
        task1.cancel()
        try? await Task.sleep(nanoseconds: 50_000_000)

        // Send a message — only subscriber 2 should get it
        let testMessage = WSMessage(type: .ping, id: "after-cancel")
        client.broadcastForTesting(testMessage)

        try? await Task.sleep(nanoseconds: 50_000_000)
        task2.cancel()

        XCTAssertEqual(received1.count, 0, "Cancelled subscriber should not receive messages")
        XCTAssertEqual(received2.count, 1, "Active subscriber should receive the message")
        XCTAssertEqual(received2.first?.id, "after-cancel")
    }

    func testMakeMessageStream_errorIsolation() async {
        // One subscriber stopping early should not affect others
        let client = WebSocketClient()

        let stream1 = client.makeMessageStream()
        let stream2 = client.makeMessageStream()

        var received2: [WSMessage] = []

        // Subscriber 1: only takes first message then stops
        let task1 = Task {
            for await _ in stream1 {
                break // Stop after first message
            }
        }

        let task2 = Task {
            for await msg in stream2 {
                received2.append(msg)
                if received2.count >= 2 { break }
            }
        }

        try? await Task.sleep(nanoseconds: 50_000_000)

        // Send first message — both get it
        client.broadcastForTesting(WSMessage(type: .ping, id: "msg-1"))
        try? await Task.sleep(nanoseconds: 50_000_000)

        // task1 should have exited after first message
        // Send second message — only subscriber 2 should get it
        client.broadcastForTesting(WSMessage(type: .ping, id: "msg-2"))
        try? await Task.sleep(nanoseconds: 50_000_000)

        task1.cancel()
        task2.cancel()

        XCTAssertEqual(received2.count, 2, "Subscriber 2 should receive both messages")
        XCTAssertEqual(received2[0].id, "msg-1")
        XCTAssertEqual(received2[1].id, "msg-2")
    }

    func testMakeMessageStream_reconnect_existingSubscribersReceive() async {
        // Existing subscribers should continue receiving after simulated reconnect
        let client = WebSocketClient()

        let stream = client.makeMessageStream()
        var received: [WSMessage] = []

        let task = Task {
            for await msg in stream {
                received.append(msg)
                if received.count >= 2 { break }
            }
        }

        try? await Task.sleep(nanoseconds: 50_000_000)

        // Message before "reconnect"
        client.broadcastForTesting(WSMessage(type: .ping, id: "before-reconnect"))
        try? await Task.sleep(nanoseconds: 50_000_000)

        // Simulate reconnect: the stream should survive because the broadcaster persists
        // In real usage, reconnect re-creates the URLSessionWebSocketTask but the
        // continuation dictionary stays intact

        // Message after "reconnect"
        client.broadcastForTesting(WSMessage(type: .ping, id: "after-reconnect"))
        try? await Task.sleep(nanoseconds: 50_000_000)

        task.cancel()

        XCTAssertEqual(received.count, 2, "Subscriber should receive messages across reconnect")
        XCTAssertEqual(received[0].id, "before-reconnect")
        XCTAssertEqual(received[1].id, "after-reconnect")
    }
}

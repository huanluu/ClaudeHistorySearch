import SwiftUI
import ClaudeHistoryShared

@main
struct ClaudeHistorySearchApp: App {
    @StateObject private var serverDiscovery = ServerDiscovery()
    @StateObject private var apiClient = APIClient()
    @StateObject private var webSocketClient = WebSocketClient()

    var body: some Scene {
        WindowGroup {
            SessionListView()
                .environmentObject(serverDiscovery)
                .environmentObject(apiClient)
                .environmentObject(webSocketClient)
                .task {
                    // API key is now loaded in APIClient.init() to avoid race conditions

                    // Verify cached URL or discover via Bonjour
                    // This handles corpnet where Bonjour is blocked but cached IP works
                    serverDiscovery.verifyAndConnect()

                    // Wait for connection to establish
                    try? await Task.sleep(nanoseconds: 2_000_000_000)

                    // If we have a URL now, configure WebSocket
                    if let url = serverDiscovery.serverURL {
                        configureWebSocket(baseURL: url)
                    } else {
                        // Try localhost as last resort (for local development)
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        if serverDiscovery.serverURL == nil {
                            await tryLocalhostFallback()
                        }
                    }
                }
                .onChange(of: serverDiscovery.serverURL) { _, newURL in
                    // Configure WebSocket when server URL changes
                    if let url = newURL {
                        configureWebSocket(baseURL: url)
                    }
                }
        }
    }

    @MainActor
    private func tryLocalhostFallback() async {
        let localhostURL = URL(string: "http://localhost:3847")!
        apiClient.setBaseURL(localhostURL)

        do {
            let healthy = try await apiClient.checkHealth()
            if healthy {
                serverDiscovery.setManualURL("http://localhost:3847")
                configureWebSocket(baseURL: localhostURL)
                print("Connected to localhost:3847")
            }
        } catch {
            print("Localhost fallback failed: \(error)")
        }
    }

    @MainActor
    private func configureWebSocket(baseURL: URL) {
        webSocketClient.configure(baseURL: baseURL, apiKey: apiClient.getAPIKey())

        // Auto-connect WebSocket
        Task {
            do {
                try await webSocketClient.connect()
                print("[WebSocket] Connected successfully")
            } catch {
                print("[ ] Connection failed: \(error)")
            }
        }
    }
}

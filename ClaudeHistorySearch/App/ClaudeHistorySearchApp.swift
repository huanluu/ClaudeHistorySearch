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
                    // Load API key from keychain
                    apiClient.loadAPIKeyFromKeychain()

                    // Auto-start server discovery if not connected
                    if serverDiscovery.serverURL == nil {
                        serverDiscovery.startSearching()

                        // Try localhost fallback after 3 seconds if still not connected
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
                print("[WebSocket] Connection failed: \(error)")
            }
        }
    }
}

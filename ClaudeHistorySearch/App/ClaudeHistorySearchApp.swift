import SwiftUI
import ClaudeHistoryShared

@main
struct ClaudeHistorySearchApp: App {
    @StateObject private var serverDiscovery = ServerDiscovery()
    @StateObject private var viewModel: SessionListViewModel

    private let apiClient: APIClient
    private let webSocketClient: WebSocketClient

    init() {
        let api = APIClient()
        let ws = WebSocketClient()
        self.apiClient = api
        self.webSocketClient = ws
        self._viewModel = StateObject(wrappedValue: SessionListViewModel(apiClient: api))
    }

    var body: some Scene {
        WindowGroup {
            SessionListView()
                .environmentObject(serverDiscovery)
                .environmentObject(viewModel)
                .environment(\.apiClient, apiClient)
                .environment(\.webSocketClient, webSocketClient)
                .task {
                    // Verify cached URL or discover via Bonjour
                    serverDiscovery.verifyAndConnect()

                    // Wait for connection to establish
                    try? await Task.sleep(nanoseconds: 2_000_000_000)

                    // If we have a URL now, configure API client and WebSocket
                    if let url = serverDiscovery.serverURL {
                        apiClient.setBaseURL(url)
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
                    apiClient.setBaseURL(newURL)
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
            }
        } catch {
            // Localhost not available
        }
    }

    @MainActor
    private func configureWebSocket(baseURL: URL) {
        webSocketClient.configure(baseURL: baseURL, apiKey: apiClient.getAPIKey())

        Task {
            do {
                try await webSocketClient.connect()
            } catch {
                // WebSocket connection failed — non-fatal
            }
        }
    }
}

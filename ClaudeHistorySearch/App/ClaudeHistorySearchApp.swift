import SwiftUI
import ClaudeHistoryShared

@main
struct ClaudeHistorySearchApp: App {
    @StateObject private var serverDiscovery = ServerDiscovery()
    @StateObject private var apiClient = APIClient()

    var body: some Scene {
        WindowGroup {
            SessionListView()
                .environmentObject(serverDiscovery)
                .environmentObject(apiClient)
                .task {
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
                print("Connected to localhost:3847")
            }
        } catch {
            print("Localhost fallback failed: \(error)")
        }
    }
}

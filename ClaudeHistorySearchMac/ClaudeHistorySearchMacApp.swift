import SwiftUI
import ClaudeHistoryShared

@main
struct ClaudeHistorySearchMacApp: App {
    @StateObject private var serverDiscovery = ServerDiscovery()
    @StateObject private var apiClient = APIClient()

    var body: some Scene {
        MenuBarExtra("Claude", systemImage: "message") {
            SearchPopoverView()
                .environmentObject(serverDiscovery)
                .environmentObject(apiClient)
                .task {
                    await autoConnect()
                }
        }
        .menuBarExtraStyle(.window)
    }

    @MainActor
    private func autoConnect() async {
        // If already connected, just ensure apiClient has the URL
        if let existingURL = serverDiscovery.serverURL {
            apiClient.setBaseURL(existingURL)
            return
        }

        // Try localhost first (most common for local dev)
        let localhostURL = URL(string: "http://localhost:3847")!
        apiClient.setBaseURL(localhostURL)

        do {
            let healthy = try await apiClient.checkHealth()
            if healthy {
                serverDiscovery.setManualURL("http://localhost:3847")
                return
            }
        } catch {
            // Localhost failed, try Bonjour
        }

        // Fall back to Bonjour discovery
        serverDiscovery.startSearching()

        // Wait a bit for Bonjour
        try? await Task.sleep(nanoseconds: 3_000_000_000)

        // Update API client if we found something
        if let url = serverDiscovery.serverURL {
            apiClient.setBaseURL(url)
        }
    }
}

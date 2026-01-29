import SwiftUI
import ClaudeHistoryShared

enum NavigationDestination: Hashable {
    case sessionDetail(sessionId: String, highlightText: String?, scrollToMessageId: String?)
}

struct SearchPopoverView: View {
    @EnvironmentObject var serverDiscovery: ServerDiscovery
    @EnvironmentObject var apiClient: APIClient

    @State private var searchText = ""
    @State private var searchResults: [SearchResult] = []
    @State private var recentSessions: [Session] = []
    @State private var isSearching = false
    @State private var isLoadingSessions = false
    @State private var navigationPath = NavigationPath()
    @State private var showSettings = false

    @FocusState private var isSearchFieldFocused: Bool

    var body: some View {
        NavigationStack(path: $navigationPath) {
            VStack(spacing: 0) {
                // Header
                headerView

                Divider()

                // Search field
                searchFieldView

                Divider()

                // Content
                if serverDiscovery.serverURL == nil {
                    disconnectedView
                } else if isSearching || isLoadingSessions {
                    loadingView
                } else if !searchText.isEmpty {
                    // Show search results
                    if searchResults.isEmpty {
                        noResultsView
                    } else {
                        searchResultsListView
                    }
                } else {
                    // Show recent sessions
                    if recentSessions.isEmpty {
                        emptySessionsView
                    } else {
                        recentSessionsListView
                    }
                }
            }
            .frame(width: 420, height: 500)
            .navigationDestination(for: NavigationDestination.self) { destination in
                switch destination {
                case .sessionDetail(let sessionId, let highlightText, let scrollToMessageId):
                    SessionDetailView(
                        sessionId: sessionId,
                        highlightText: highlightText,
                        scrollToMessageId: scrollToMessageId,
                        onBack: { navigationPath.removeLast() }
                    )
                    .environmentObject(apiClient)
                    .toolbar(.hidden)
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(serverDiscovery)
        }
        .onAppear {
            isSearchFieldFocused = true
            // Refresh recent sessions each time popover appears
            Task {
                await loadRecentSessions()
            }
        }
        .onChange(of: serverDiscovery.serverURL) { _ in
            Task {
                await loadRecentSessions()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popoverDidShow)) { _ in
            isSearchFieldFocused = true
            Task {
                await loadRecentSessions()
            }
        }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack {
            // Connection status
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(statusText)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Settings button
            Button(action: { showSettings = true }) {
                Image(systemName: "gearshape")
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var statusColor: Color {
        switch serverDiscovery.connectionStatus {
        case .connected: return .green
        case .searching: return .orange
        case .error: return .red
        case .disconnected: return .gray
        }
    }

    private var statusText: String {
        switch serverDiscovery.connectionStatus {
        case .connected(let host): return "Connected to \(host)"
        case .searching: return "Searching..."
        case .error(let msg): return "Error: \(msg)"
        case .disconnected: return "Disconnected"
        }
    }

    // MARK: - Search Field

    private var searchFieldView: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)

            TextField("Search Claude sessions...", text: $searchText)
                .textFieldStyle(.plain)
                .focused($isSearchFieldFocused)
                .onSubmit {
                    Task {
                        await performSearch()
                    }
                }

            if !searchText.isEmpty {
                Button(action: {
                    searchText = ""
                    searchResults = []
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(10)
        .onChange(of: searchText) { _ in
            Task {
                await performSearch()
            }
        }
    }

    // MARK: - States

    private var disconnectedView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "server.rack")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("No Server Connected")
                .font(.headline)
            Text("Start the Claude History Server or configure connection in settings.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button("Search for Server") {
                serverDiscovery.startSearching()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(serverDiscovery.isSearching)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var loadingView: some View {
        VStack {
            Spacer()
            ProgressView()
                .scaleEffect(0.8)
            Text(isSearching ? "Searching..." : "Loading...")
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.top, 8)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noResultsView: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("No Results")
                .font(.headline)
            Text("No matches found for \"\(searchText)\"")
                .font(.caption)
                .foregroundColor(.secondary)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptySessionsView: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "text.bubble")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("No Sessions")
                .font(.headline)
            Text("Your Claude conversation history will appear here.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Recent Sessions List

    private var recentSessionsListView: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                // Section header
                HStack {
                    Text("Recent Sessions")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

                ForEach(recentSessions) { session in
                    SessionRowView(session: session) {
                        navigationPath.append(NavigationDestination.sessionDetail(
                            sessionId: session.id,
                            highlightText: nil,
                            scrollToMessageId: nil
                        ))
                    }
                    Divider()
                        .padding(.leading, 12)
                }
            }
        }
    }

    // MARK: - Search Results List

    private var searchResultsListView: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(searchResults) { result in
                    SearchResultRowView(result: result, query: searchText) {
                        navigationPath.append(NavigationDestination.sessionDetail(
                            sessionId: result.sessionId,
                            highlightText: searchText,
                            scrollToMessageId: result.message.uuid
                        ))
                    }
                    Divider()
                        .padding(.leading, 12)
                }
            }
        }
    }

    // MARK: - Data Loading

    private func loadRecentSessions() async {
        guard serverDiscovery.serverURL != nil else { return }

        isLoadingSessions = true

        do {
            let response = try await apiClient.fetchSessions(limit: 20, offset: 0)
            recentSessions = response.sessions
        } catch {
            recentSessions = []
        }

        isLoadingSessions = false
    }

    private func performSearch() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !query.isEmpty else {
            searchResults = []
            return
        }

        // Debounce
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard query == searchText.trimmingCharacters(in: .whitespacesAndNewlines) else { return }

        isSearching = true

        do {
            let response = try await apiClient.search(query: query)
            searchResults = response.results
        } catch {
            searchResults = []
        }

        isSearching = false
    }
}

// MARK: - Session Row View

struct SessionRowView: View {
    let session: Session
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 10) {
                // Chat icon
                Image(systemName: "bubble.left.and.bubble.right")
                    .foregroundColor(.blue)
                    .font(.system(size: 14))
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 4) {
                    // Session title and date
                    HStack {
                        Text(session.displayName)
                            .font(.headline)
                            .lineLimit(1)
                        Spacer()
                        Text(session.startedAtDate, style: .relative)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    // Project folder path
                    Text(session.projectName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)

                    // Preview
                    Text(session.preview)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(2)

                    // Message count
                    HStack(spacing: 4) {
                        Image(systemName: "message")
                            .font(.caption2)
                        Text("\(session.messageCount) messages")
                            .font(.caption2)
                    }
                    .foregroundColor(.secondary)
                }

                // Chevron
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    SearchPopoverView()
        .environmentObject(ServerDiscovery())
        .environmentObject(APIClient())
}

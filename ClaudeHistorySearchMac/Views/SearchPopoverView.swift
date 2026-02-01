import SwiftUI
import ClaudeHistoryShared

enum NavigationDestination: Hashable {
    case sessionDetail(sessionId: String, highlightText: String?, scrollToMessageId: String?)
}

struct SearchPopoverView: View {
    @EnvironmentObject var serverDiscovery: ServerDiscovery
    @EnvironmentObject var apiClient: APIClient
    @EnvironmentObject var webSocketClient: WebSocketClient

    @AppStorage("searchSortOption") private var sortOptionRaw = SearchSortOption.relevance.rawValue
    @State private var searchText = ""
    @State private var searchResults: [SearchResult] = []
    @State private var recentSessions: [Session] = []
    @State private var isSearching = false
    @State private var isLoadingSessions = false
    @State private var navigationPath = NavigationPath()
    @State private var showSettings = false

    @FocusState private var isSearchFieldFocused: Bool

    private var sortOption: SearchSortOption {
        get { SearchSortOption(rawValue: sortOptionRaw) ?? .relevance }
    }

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
                    SessionView(
                        sessionId: sessionId,
                        highlightText: highlightText,
                        scrollToMessageId: scrollToMessageId,
                        webSocketClient: webSocketClient,
                        onBack: { navigationPath.removeLast() },
                        onOpenInTerminal: { sessionId, workingDir in
                            try? TerminalService.shared.openSession(
                                sessionId: sessionId,
                                workingDirectory: workingDir
                            )
                        }
                    )
                    .environmentObject(apiClient)
                    .toolbar(.hidden)
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(serverDiscovery: serverDiscovery, apiClient: apiClient)
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

            // New session button
            if serverDiscovery.serverURL != nil {
                Button(action: {
                    try? TerminalService.shared.startNewSession()
                }) {
                    Image(systemName: "plus.circle.fill")
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)
                .help("Start new session in iTerm2")
            }

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
                // Sort picker (inline, before cancel button)
                Menu {
                    ForEach(SearchSortOption.allCases) { option in
                        Button {
                            sortOptionRaw = option.rawValue
                            Task {
                                await performSearch()
                            }
                        } label: {
                            HStack {
                                Text(option.displayName)
                                if sortOption == option {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    Text(sortOption.displayName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.secondary.opacity(0.1))
                        .cornerRadius(6)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()

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
                    Button {
                        navigationPath.append(NavigationDestination.sessionDetail(
                            sessionId: session.id,
                            highlightText: nil,
                            scrollToMessageId: nil
                        ))
                    } label: {
                        SessionRowContent(session: session, style: .compact)
                    }
                    .buttonStyle(.plain)
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
                    Button {
                        navigationPath.append(NavigationDestination.sessionDetail(
                            sessionId: result.sessionId,
                            highlightText: searchText,
                            scrollToMessageId: result.message.uuid
                        ))
                    } label: {
                        SearchResultRowContent(result: result, query: searchText, style: .compact)
                    }
                    .buttonStyle(.plain)
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
            let response = try await apiClient.search(query: query, sort: sortOption)
            searchResults = response.results
        } catch {
            searchResults = []
        }

        isSearching = false
    }
}

// Row views now use shared components from ClaudeHistoryShared:
// - SessionRowContent
// - SearchResultRowContent

#Preview {
    SearchPopoverView()
        .environmentObject(ServerDiscovery())
        .environmentObject(APIClient())
        .environmentObject(WebSocketClient())
}

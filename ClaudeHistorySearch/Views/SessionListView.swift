import SwiftUI
import ClaudeHistoryShared

struct SessionListView: View {
    @EnvironmentObject var serverDiscovery: ServerDiscovery
    @EnvironmentObject var apiClient: APIClient
    @EnvironmentObject var webSocketClient: WebSocketClient

    @AppStorage("searchSortOption") private var sortOptionRaw = SearchSortOption.relevance.rawValue
    @State private var sessions: [Session] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var searchText = ""
    @State private var searchResults: [SearchResult] = []
    @State private var isSearching = false
    @State private var hasMoreSessions = true
    @State private var currentOffset = 0
    @State private var showSettings = false
    @State private var showNewSession = false

    private let pageSize = 20

    private var sortOption: SearchSortOption {
        SearchSortOption(rawValue: sortOptionRaw) ?? .relevance
    }

    var body: some View {
        NavigationStack {
            Group {
                if serverDiscovery.serverURL == nil {
                    connectionView
                } else if !searchText.isEmpty {
                    searchResultsView
                } else {
                    sessionsListView
                }
            }
            .navigationTitle("Claude Sessions")
            .searchable(text: $searchText, prompt: "Search conversations")
            .onChange(of: searchText) { _, newValue in
                Task {
                    await performSearch(query: newValue)
                }
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    if serverDiscovery.serverURL != nil {
                        Button(action: { showNewSession = true }) {
                            Image(systemName: "plus.circle.fill")
                        }
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showSettings = true }) {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView(serverDiscovery: serverDiscovery, apiClient: apiClient)
            }
            .sheet(isPresented: $showNewSession) {
                NewSessionView(webSocketClient: webSocketClient)
            }
            .refreshable {
                await loadSessions(refresh: true)
            }
        }
        .task {
            apiClient.setBaseURL(serverDiscovery.serverURL)
            if serverDiscovery.serverURL != nil && sessions.isEmpty {
                await loadSessions()
            }
        }
        .onChange(of: serverDiscovery.serverURL) { _, newURL in
            apiClient.setBaseURL(newURL)
            if newURL != nil {
                Task {
                    await loadSessions(refresh: true)
                }
            }
        }
    }

    // MARK: - Connection View

    private var connectionView: some View {
        VStack(spacing: 20) {
            Image(systemName: "server.rack")
                .font(.system(size: 60))
                .foregroundColor(.secondary)

            Text("No Server Connected")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Start the Claude History Server on your Mac, or enter the URL manually.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button(action: {
                serverDiscovery.startSearching()
            }) {
                HStack {
                    if serverDiscovery.isSearching {
                        ProgressView()
                            .padding(.trailing, 4)
                    }
                    Text(serverDiscovery.isSearching ? "Searching..." : "Search for Server")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(serverDiscovery.isSearching)
            .padding(.horizontal, 40)

            Text(serverDiscovery.connectionStatus.description)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
    }

    // MARK: - Sessions List

    private var sessionsListView: some View {
        List {
            if isLoading && sessions.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
            } else if let error = error {
                Text(error)
                    .foregroundColor(.red)
                    .listRowSeparator(.hidden)
            } else if sessions.isEmpty {
                Text("No sessions found")
                    .foregroundColor(.secondary)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(groupedSessions.keys.sorted().reversed(), id: \.self) { date in
                    Section(header: Text(formatSectionDate(date))) {
                        ForEach(groupedSessions[date] ?? []) { session in
                            NavigationLink(value: session) {
                                SessionRowContent(session: session)
                            }
                        }
                    }
                }

                if hasMoreSessions {
                    Button("Load More") {
                        Task {
                            await loadMoreSessions()
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
                }
            }
        }
        .listStyle(.plain)
        .navigationDestination(for: Session.self) { session in
            SessionView(session: session, webSocketClient: webSocketClient)
        }
    }

    private var groupedSessions: [Date: [Session]] {
        let calendar = Calendar.current
        return Dictionary(grouping: sessions) { session in
            calendar.startOfDay(for: session.startedAtDate)
        }
    }

    private func formatSectionDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        let calendar = Calendar.current

        if calendar.isDateInToday(date) {
            return "Today"
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else {
            formatter.dateStyle = .medium
            return formatter.string(from: date)
        }
    }

    // MARK: - Search Results

    private var searchResultsView: some View {
        List {
            // Sort filter picker (compact, inline style)
            HStack {
                Spacer()
                Menu {
                    ForEach(SearchSortOption.allCases) { option in
                        Button {
                            sortOptionRaw = option.rawValue
                            Task {
                                await performSearch(query: searchText)
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
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color(.systemGray5))
                        .cornerRadius(8)
                }
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))

            if isSearching {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
            } else if searchResults.isEmpty && !searchText.isEmpty {
                Text("No results for \"\(searchText)\"")
                    .foregroundColor(.secondary)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(searchResults) { result in
                    NavigationLink {
                        SessionView(
                            sessionId: result.sessionId,
                            highlightText: searchText,
                            scrollToMessageId: result.message.uuid,
                            webSocketClient: webSocketClient
                        )
                    } label: {
                        SearchResultRowContent(result: result, query: searchText)
                    }
                }
            }
        }
        .listStyle(.plain)
    }

    // MARK: - Data Loading

    private func loadSessions(refresh: Bool = false) async {
        guard !isLoading else { return }

        isLoading = true
        error = nil

        if refresh {
            currentOffset = 0
            sessions = []
        }

        do {
            let response = try await apiClient.fetchSessions(limit: pageSize, offset: 0)
            sessions = response.sessions
            hasMoreSessions = response.pagination.hasMore
            currentOffset = response.sessions.count
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    private func loadMoreSessions() async {
        guard !isLoading && hasMoreSessions else { return }

        isLoading = true

        do {
            let response = try await apiClient.fetchSessions(limit: pageSize, offset: currentOffset)
            sessions.append(contentsOf: response.sessions)
            hasMoreSessions = response.pagination.hasMore
            currentOffset += response.sessions.count
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    private func performSearch(query: String) async {
        guard !query.isEmpty else {
            searchResults = []
            return
        }

        // Debounce
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard query == searchText else { return }

        isSearching = true

        do {
            let response = try await apiClient.search(query: query, sort: sortOption)
            searchResults = response.results
        } catch {
            // Silent fail for search
            searchResults = []
        }

        isSearching = false
    }
}

// MARK: - Views
// Row views and SettingsView now use shared components from ClaudeHistoryShared

#Preview {
    SessionListView()
        .environmentObject(ServerDiscovery())
        .environmentObject(APIClient())
        .environmentObject(WebSocketClient())
}

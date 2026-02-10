import SwiftUI
import ClaudeHistoryShared

struct SessionListView: View {
    @EnvironmentObject var serverDiscovery: ServerDiscovery
    @EnvironmentObject var apiClient: APIClient
    @EnvironmentObject var webSocketClient: WebSocketClient

    @StateObject private var viewModel: SessionListViewModel

    @AppStorage("searchSortOption") private var sortOptionRaw = SearchSortOption.relevance.rawValue
    @State private var searchText = ""
    @State private var showSettings = false
    @State private var showNewSession = false

    private var sortOption: SearchSortOption {
        SearchSortOption(rawValue: sortOptionRaw) ?? .relevance
    }

    init() {
        // Temporary init — real apiClient is set in .task via viewModel
        _viewModel = StateObject(wrappedValue: SessionListViewModel(apiClient: APIClient()))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Tab picker — visible in both session list and search modes
                if serverDiscovery.serverURL != nil {
                    Picker("", selection: $viewModel.selectedTab) {
                        ForEach(SessionListViewModel.Tab.allCases, id: \.self) { tab in
                            Text(tab.rawValue).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .onChange(of: viewModel.selectedTab) { _, newTab in
                        viewModel.switchTab(to: newTab)
                        if !searchText.isEmpty {
                            Task { await viewModel.search(query: searchText, sort: sortOption) }
                        }
                    }
                }

                Group {
                    if serverDiscovery.serverURL == nil {
                        connectionView
                    } else if !searchText.isEmpty {
                        searchResultsView
                    } else {
                        sessionsListView
                    }
                }
            }
            .navigationTitle("Claude Sessions")
            .searchable(text: $searchText, prompt: "Search conversations")
            .onChange(of: searchText) { _, newValue in
                Task {
                    // Debounce
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    guard newValue == searchText else { return }
                    await viewModel.search(query: newValue, sort: sortOption)
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
                await viewModel.loadSessions(refresh: true)
            }
        }
        .task {
            apiClient.setBaseURL(serverDiscovery.serverURL)
            // Re-initialize viewModel's apiClient reference
            viewModel.setAPIClient(apiClient)
            if serverDiscovery.serverURL != nil && viewModel.sessions.isEmpty {
                await viewModel.loadSessions()
            }
        }
        .onChange(of: serverDiscovery.serverURL) { _, newURL in
            apiClient.setBaseURL(newURL)
            if newURL != nil {
                Task {
                    await viewModel.loadSessions(refresh: true)
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
            if viewModel.isLoading && viewModel.sessions.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
            } else if let error = viewModel.error {
                Text(error)
                    .foregroundColor(.red)
                    .listRowSeparator(.hidden)
            } else if viewModel.sessions.isEmpty {
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
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task { await viewModel.deleteSession(session) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }

                if viewModel.hasMore {
                    Button("Load More") {
                        Task {
                            await viewModel.loadMore()
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
        return Dictionary(grouping: viewModel.sessions) { session in
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
                                await viewModel.search(query: searchText, sort: sortOption)
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

            if viewModel.isSearching {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
            } else if viewModel.searchResults.isEmpty && !searchText.isEmpty {
                Text("No results for \"\(searchText)\"")
                    .foregroundColor(.secondary)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(viewModel.searchResults) { result in
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
}

// MARK: - Views
// Row views and SettingsView now use shared components from ClaudeHistoryShared

#Preview {
    SessionListView()
        .environmentObject(ServerDiscovery())
        .environmentObject(APIClient())
        .environmentObject(WebSocketClient())
}

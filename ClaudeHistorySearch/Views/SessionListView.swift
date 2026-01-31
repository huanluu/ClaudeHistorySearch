import SwiftUI
import ClaudeHistoryShared

struct SessionListView: View {
    @EnvironmentObject var serverDiscovery: ServerDiscovery
    @EnvironmentObject var apiClient: APIClient

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
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showSettings = true }) {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
                    .environmentObject(serverDiscovery)
                    .environmentObject(apiClient)
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
                                SessionRowView(session: session)
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
            SessionDetailView(session: session)
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
                        SessionDetailView(
                            sessionId: result.sessionId,
                            highlightText: searchText,
                            scrollToMessageId: result.message.uuid
                        )
                    } label: {
                        SearchResultRowView(result: result, query: searchText)
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

// MARK: - Session Row

struct SessionRowView: View {
    let session: Session

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(session.displayName)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                Text(session.startedAtDate, style: .relative)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Text(session.preview)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .lineLimit(2)

            HStack {
                Image(systemName: "message")
                    .font(.caption2)
                Text("\(session.messageCount) messages")
                    .font(.caption2)
            }
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Search Result Row

struct SearchResultRowView: View {
    let result: SearchResult
    let query: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: result.message.isUser ? "person.fill" : "bubble.left.fill")
                    .foregroundColor(result.message.isUser ? .blue : .gray)
                Text(result.message.isUser ? "You" : "Claude")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Text(result.startedAtDate, style: .date)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Text(highlightedPreview)
                .font(.subheadline)
                .lineLimit(3)
        }
        .padding(.vertical, 4)
    }

    private var highlightedPreview: AttributedString {
        let content = String(result.message.content.prefix(200))
        var attributedString = AttributedString(content)

        let lowercasedContent = content.lowercased()
        let lowercasedQuery = query.lowercased()
        var searchStart = lowercasedContent.startIndex

        while let range = lowercasedContent.range(of: lowercasedQuery, range: searchStart..<lowercasedContent.endIndex) {
            if let attrStart = AttributedString.Index(range.lowerBound, within: attributedString),
               let attrEnd = AttributedString.Index(range.upperBound, within: attributedString) {
                attributedString[attrStart..<attrEnd].backgroundColor = .yellow
                attributedString[attrStart..<attrEnd].foregroundColor = .black
            }
            searchStart = range.upperBound
        }

        return attributedString
    }
}

// MARK: - Settings View

struct SettingsView: View {
    @EnvironmentObject var serverDiscovery: ServerDiscovery
    @EnvironmentObject var apiClient: APIClient
    @Environment(\.dismiss) var dismiss
    @State private var manualURL = ""
    @State private var apiKeyInput = ""
    @State private var showAPIKey = false
    @State private var apiKeyStatus: APIKeyStatus = .unknown

    enum APIKeyStatus {
        case unknown, saved, error(String)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Server Connection") {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text(serverDiscovery.connectionStatus.description)
                            .foregroundColor(.secondary)
                    }

                    if let url = serverDiscovery.serverURL {
                        HStack {
                            Text("URL")
                            Spacer()
                            Text(url.absoluteString)
                                .foregroundColor(.secondary)
                                .font(.caption)
                        }
                    }

                    Button("Search for Server") {
                        serverDiscovery.startSearching()
                    }
                    .disabled(serverDiscovery.isSearching)

                    if serverDiscovery.serverURL != nil {
                        Button("Disconnect", role: .destructive) {
                            serverDiscovery.disconnect()
                        }
                    }
                }

                Section("Authentication") {
                    HStack {
                        Text("Status")
                        Spacer()
                        HStack(spacing: 6) {
                            Circle()
                                .fill(apiClient.isAuthenticated ? Color.green : Color.red)
                                .frame(width: 8, height: 8)
                            Text(apiClient.isAuthenticated ? "Authenticated" : "Not authenticated")
                                .foregroundColor(.secondary)
                        }
                    }

                    HStack {
                        if showAPIKey {
                            TextField("Enter API Key", text: $apiKeyInput)
                                .textContentType(.password)
                                .autocapitalization(.none)
                        } else {
                            SecureField("Enter API Key", text: $apiKeyInput)
                        }
                        Button(action: { showAPIKey.toggle() }) {
                            Image(systemName: showAPIKey ? "eye.slash" : "eye")
                        }
                    }

                    Button("Save Key") {
                        saveAPIKey()
                    }
                    .disabled(apiKeyInput.isEmpty)

                    if KeychainHelper.shared.hasAPIKey() {
                        Button("Clear Key", role: .destructive) {
                            clearAPIKey()
                        }
                    }

                    if case .error(let message) = apiKeyStatus {
                        Text(message)
                            .foregroundColor(.red)
                            .font(.caption)
                    } else if case .saved = apiKeyStatus {
                        Text("API key saved")
                            .foregroundColor(.green)
                            .font(.caption)
                    }
                }

                Section("Manual Connection") {
                    TextField("http://192.168.1.x:3847", text: $manualURL)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)

                    Button("Connect") {
                        serverDiscovery.setManualURL(manualURL)
                    }
                    .disabled(manualURL.isEmpty)
                }

                Section("About") {
                    HStack {
                        Text("Server Port")
                        Spacer()
                        Text("3847")
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Service Type")
                        Spacer()
                        Text("_claudehistory._tcp")
                            .foregroundColor(.secondary)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func saveAPIKey() {
        do {
            try apiClient.saveAPIKeyToKeychain(apiKeyInput)
            apiKeyInput = ""
            apiKeyStatus = .saved
        } catch {
            apiKeyStatus = .error(error.localizedDescription)
        }
    }

    private func clearAPIKey() {
        do {
            try apiClient.clearAPIKey()
            apiKeyStatus = .unknown
        } catch {
            apiKeyStatus = .error(error.localizedDescription)
        }
    }
}

#Preview {
    SessionListView()
        .environmentObject(ServerDiscovery())
        .environmentObject(APIClient())
}

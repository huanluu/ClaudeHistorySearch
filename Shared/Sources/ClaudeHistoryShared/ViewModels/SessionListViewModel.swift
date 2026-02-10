import Foundation

/// ViewModel for managing the session list with tab-based filtering.
/// Shared between iOS and macOS to centralize session listing, searching, and deletion logic.
@MainActor
public class SessionListViewModel: ObservableObject {
    public enum Tab: String, CaseIterable {
        case sessions = "Sessions"
        case heartbeat = "Heartbeat"
    }

    // MARK: - Published State

    @Published public var selectedTab: Tab = .sessions
    @Published public var sessions: [Session] = []
    @Published public var searchResults: [SearchResult] = []
    @Published public var isLoading = false
    @Published public var isSearching = false
    @Published public var hasMore = true
    @Published public var error: String?

    // MARK: - Private State

    private var apiClient: any NetworkService
    private var currentOffset = 0
    private let pageSize: Int

    // MARK: - Init

    public init(apiClient: any NetworkService, pageSize: Int = 20) {
        self.apiClient = apiClient
        self.pageSize = pageSize
    }

    /// Replace the API client (used when the real EnvironmentObject becomes available)
    public func setAPIClient(_ client: any NetworkService) {
        self.apiClient = client
    }

    // MARK: - Computed

    /// Maps the selected tab to the `automatic` API parameter
    private var automaticParam: Bool {
        selectedTab == .heartbeat
    }

    // MARK: - Session Loading

    public func loadSessions(refresh: Bool = false) async {
        guard !isLoading else { return }

        isLoading = true
        error = nil

        if refresh {
            currentOffset = 0
            sessions = []
        }

        do {
            let response = try await apiClient.fetchSessions(
                limit: pageSize, offset: 0, automatic: automaticParam
            )
            sessions = response.sessions
            hasMore = response.pagination.hasMore
            currentOffset = response.sessions.count
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    public func loadMore() async {
        guard !isLoading && hasMore else { return }

        isLoading = true

        do {
            let response = try await apiClient.fetchSessions(
                limit: pageSize, offset: currentOffset, automatic: automaticParam
            )
            sessions.append(contentsOf: response.sessions)
            hasMore = response.pagination.hasMore
            currentOffset += response.sessions.count
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    // MARK: - Search

    public func search(query: String, sort: SearchSortOption) async {
        guard !query.isEmpty else {
            searchResults = []
            return
        }

        isSearching = true

        do {
            let response = try await apiClient.search(
                query: query, limit: 50, offset: 0, sort: sort, automatic: automaticParam
            )
            searchResults = response.results
        } catch {
            searchResults = []
        }

        isSearching = false
    }

    // MARK: - Deletion

    public func deleteSession(_ session: Session) async {
        do {
            try await apiClient.deleteSession(id: session.id)
            sessions.removeAll { $0.id == session.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Tab Switching

    public func switchTab(to tab: Tab) {
        selectedTab = tab
        sessions = []
        currentOffset = 0
        hasMore = true
        Task { await loadSessions() }
    }
}

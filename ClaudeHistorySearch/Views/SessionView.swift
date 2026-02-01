import SwiftUI
import ClaudeHistoryShared

/// Unified session view that supports both historical and live modes.
/// In Phase 5: Only historical mode is implemented.
struct SessionView: View {
    @EnvironmentObject var apiClient: APIClient

    // Session identification
    let session: Session?
    let sessionId: String?
    let highlightText: String?
    let scrollToMessageId: String?

    // Session mode (historical for now, live in Phase 6)
    let mode: SessionMode

    @State private var sessionDetail: SessionDetailResponse?
    @State private var isLoading = true
    @State private var error: String?

    // MARK: - Initializers

    /// Initialize for viewing a historical session with Session object
    init(session: Session) {
        self.session = session
        self.sessionId = session.id
        self.highlightText = nil
        self.scrollToMessageId = nil
        self.mode = .historical
    }

    /// Initialize for viewing a historical session by ID (from search results)
    init(sessionId: String, highlightText: String? = nil, scrollToMessageId: String? = nil) {
        self.session = nil
        self.sessionId = sessionId
        self.highlightText = highlightText
        self.scrollToMessageId = scrollToMessageId
        self.mode = .historical
    }

    var body: some View {
        Group {
            if isLoading {
                loadingView
            } else if let error = error {
                errorView(error)
            } else if let detail = sessionDetail {
                contentView(detail: detail)
            } else {
                Text("No data available")
                    .foregroundColor(.secondary)
            }
        }
        .navigationTitle(displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadSession()
        }
    }

    // MARK: - Display Title

    private var displayTitle: String {
        if let session = session {
            return session.displayName
        } else if let detail = sessionDetail {
            return detail.session.displayName
        }
        return "Conversation"
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack {
            ProgressView("Loading conversation...")
        }
    }

    // MARK: - Error View

    private func errorView(_ error: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(.orange)
            Text(error)
                .foregroundColor(.secondary)
            Button("Retry") {
                Task {
                    await loadSession()
                }
            }
            .buttonStyle(.bordered)
        }
    }

    // MARK: - Content View

    @ViewBuilder
    private func contentView(detail: SessionDetailResponse) -> some View {
        switch mode {
        case .historical:
            historicalView(detail: detail)
        case .live:
            // Phase 6: Live view implementation
            historicalView(detail: detail)
        }
    }

    @ViewBuilder
    private func historicalView(detail: SessionDetailResponse) -> some View {
        MessageListView(
            messages: detail.messages,
            session: detail.session,
            highlightText: highlightText,
            scrollToMessageId: scrollToMessageId,
            style: .default
        )
    }

    // MARK: - Data Loading

    private func loadSession() async {
        guard let id = sessionId else {
            error = "No session ID"
            isLoading = false
            return
        }

        isLoading = true
        error = nil

        do {
            sessionDetail = try await apiClient.fetchSession(id: id)
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }
}

#Preview {
    NavigationStack {
        SessionView(session: Session(
            id: "test-id",
            project: "/Users/test/Developer",
            startedAt: Int64(Date().timeIntervalSince1970 * 1000),
            messageCount: 5,
            preview: "Test preview"
        ))
        .environmentObject(APIClient())
    }
}

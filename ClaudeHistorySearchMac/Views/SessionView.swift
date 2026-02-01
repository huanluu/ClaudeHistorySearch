import SwiftUI
import ClaudeHistoryShared

/// Unified session view for macOS that supports both historical and live modes.
/// In Phase 5: Only historical mode is implemented.
struct SessionView: View {
    @EnvironmentObject var apiClient: APIClient

    let sessionId: String
    let highlightText: String?
    let scrollToMessageId: String?
    let onBack: () -> Void

    // Session mode (historical for now, live in Phase 6)
    let mode: SessionMode

    @State private var sessionDetail: SessionDetailResponse?
    @State private var isLoading = true
    @State private var error: String?

    // MARK: - Initializers

    /// Initialize for viewing a historical session
    init(
        sessionId: String,
        highlightText: String? = nil,
        scrollToMessageId: String? = nil,
        onBack: @escaping () -> Void
    ) {
        self.sessionId = sessionId
        self.highlightText = highlightText
        self.scrollToMessageId = scrollToMessageId
        self.onBack = onBack
        self.mode = .historical
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with back button
            headerView

            Divider()

            // Content
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
        .frame(width: 420, height: 500)
        .navigationBarBackButtonHidden(true)
        .task {
            await loadSession()
        }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack {
            Button(action: onBack) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                    Text("Back")
                }
            }
            .buttonStyle(.plain)
            .foregroundColor(.accentColor)

            Spacer()

            if let detail = sessionDetail {
                Text(detail.session.displayName)
                    .font(.headline)
                    .lineLimit(1)
            }

            Spacer()

            // Copy button
            if let detail = sessionDetail {
                Button(action: {
                    copyConversation(detail)
                }) {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .help("Copy conversation")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Loading/Error States

    private var loadingView: some View {
        VStack {
            Spacer()
            ProgressView()
            Text("Loading conversation...")
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.top, 8)
            Spacer()
        }
    }

    private func errorView(_ error: String) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(.orange)
            Text(error)
                .font(.caption)
                .foregroundColor(.secondary)
            Button("Retry") {
                Task {
                    await loadSession()
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            Spacer()
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
            style: .compact
        )
    }

    // MARK: - Data Loading

    private func loadSession() async {
        isLoading = true
        error = nil

        do {
            sessionDetail = try await apiClient.fetchSession(id: sessionId)
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    // MARK: - Actions

    private func copyConversation(_ detail: SessionDetailResponse) {
        let text = detail.messages.map { message in
            let role = message.isUser ? "User" : "Claude"
            return "[\(role)]\n\(message.content)"
        }.joined(separator: "\n\n---\n\n")

        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

#Preview {
    SessionView(
        sessionId: "test",
        highlightText: "SwiftUI",
        scrollToMessageId: nil,
        onBack: {}
    )
    .environmentObject(APIClient())
}

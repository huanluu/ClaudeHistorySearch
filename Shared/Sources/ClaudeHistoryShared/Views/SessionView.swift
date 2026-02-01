import SwiftUI

/// Unified session view for iOS and macOS that supports both historical and live modes.
/// Uses conditional compilation for platform-specific navigation and UI.
public struct SessionView: View {
    @EnvironmentObject var apiClient: APIClient

    // Session identification
    private let session: Session?
    private let sessionId: String
    private let highlightText: String?
    private let scrollToMessageId: String?

    // Session mode (historical for now, live in Phase 6)
    private let mode: SessionMode

    // macOS-specific: callback for custom navigation
    #if os(macOS)
    private let onBack: (() -> Void)?
    #endif

    @State private var sessionDetail: SessionDetailResponse?
    @State private var isLoading = true
    @State private var error: String?

    // MARK: - Initializers

    #if os(iOS)
    /// Initialize for viewing a historical session with Session object (iOS)
    public init(session: Session) {
        self.session = session
        self.sessionId = session.id
        self.highlightText = nil
        self.scrollToMessageId = nil
        self.mode = .historical
    }

    /// Initialize for viewing a historical session by ID (iOS - from search results)
    public init(sessionId: String, highlightText: String? = nil, scrollToMessageId: String? = nil) {
        self.session = nil
        self.sessionId = sessionId
        self.highlightText = highlightText
        self.scrollToMessageId = scrollToMessageId
        self.mode = .historical
    }
    #else
    /// Initialize for viewing a historical session (macOS)
    public init(
        sessionId: String,
        highlightText: String? = nil,
        scrollToMessageId: String? = nil,
        onBack: @escaping () -> Void
    ) {
        self.session = nil
        self.sessionId = sessionId
        self.highlightText = highlightText
        self.scrollToMessageId = scrollToMessageId
        self.onBack = onBack
        self.mode = .historical
    }
    #endif

    public var body: some View {
        #if os(iOS)
        iOSBody
        #else
        macOSBody
        #endif
    }

    // MARK: - iOS Body

    #if os(iOS)
    private var iOSBody: some View {
        Group {
            if isLoading {
                iOSLoadingView
            } else if let error = error {
                iOSErrorView(error)
            } else if let detail = sessionDetail {
                contentView(detail: detail, style: .default)
            } else {
                Text("No data available")
                    .foregroundColor(.secondary)
            }
        }
        .navigationTitle(displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if let detail = sessionDetail {
                    Button(action: { copyConversation(detail) }) {
                        Image(systemName: "doc.on.doc")
                    }
                }
            }
        }
        .task {
            await loadSession()
        }
    }

    private var iOSLoadingView: some View {
        VStack {
            ProgressView("Loading conversation...")
        }
    }

    private func iOSErrorView(_ error: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(.orange)
            Text(error)
                .foregroundColor(.secondary)
            Button("Retry") {
                Task { await loadSession() }
            }
            .buttonStyle(.bordered)
        }
    }
    #endif

    // MARK: - macOS Body

    #if os(macOS)
    private var macOSBody: some View {
        VStack(spacing: 0) {
            macOSHeaderView
            Divider()

            if isLoading {
                macOSLoadingView
            } else if let error = error {
                macOSErrorView(error)
            } else if let detail = sessionDetail {
                contentView(detail: detail, style: .compact)
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

    private var macOSHeaderView: some View {
        HStack {
            Button(action: { onBack?() }) {
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

            if let detail = sessionDetail {
                Button(action: { copyConversation(detail) }) {
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

    private var macOSLoadingView: some View {
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

    private func macOSErrorView(_ error: String) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(.orange)
            Text(error)
                .font(.caption)
                .foregroundColor(.secondary)
            Button("Retry") {
                Task { await loadSession() }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            Spacer()
        }
    }
    #endif

    // MARK: - Shared Components

    private var displayTitle: String {
        if let session = session {
            return session.displayName
        } else if let detail = sessionDetail {
            return detail.session.displayName
        }
        return "Conversation"
    }

    @ViewBuilder
    private func contentView(detail: SessionDetailResponse, style: MessageRowStyle) -> some View {
        switch mode {
        case .historical:
            MessageListView(
                messages: detail.messages,
                session: detail.session,
                highlightText: highlightText,
                scrollToMessageId: scrollToMessageId,
                style: style
            )
        case .live:
            // Phase 6: Live view implementation
            MessageListView(
                messages: detail.messages,
                session: detail.session,
                highlightText: highlightText,
                scrollToMessageId: scrollToMessageId,
                style: style
            )
        }
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

        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

#if os(iOS)
#Preview("iOS") {
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
#else
#Preview("macOS") {
    SessionView(
        sessionId: "test",
        highlightText: "SwiftUI",
        scrollToMessageId: nil,
        onBack: {}
    )
    .environmentObject(APIClient())
}
#endif

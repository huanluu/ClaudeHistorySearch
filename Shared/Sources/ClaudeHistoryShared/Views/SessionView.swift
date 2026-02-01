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
    @State private var mode: SessionMode

    // WebSocket client for live sessions (optional)
    private let webSocketClient: WebSocketClient?

    // ViewModel for live sessions
    @StateObject private var liveViewModel: SessionViewModel

    // macOS-specific: callbacks for custom navigation and terminal opening
    #if os(macOS)
    private let onBack: (() -> Void)?
    private let onOpenInTerminal: ((String, String) -> Void)?
    #endif

    @State private var sessionDetail: SessionDetailResponse?
    @State private var isLoading = true
    @State private var error: String?

    // Follow-up input state
    @State private var followUpPrompt = ""

    // MARK: - Initializers

    #if os(iOS)
    /// Initialize for viewing a historical session with Session object (iOS)
    public init(session: Session, webSocketClient: WebSocketClient? = nil) {
        self.session = session
        self.sessionId = session.id
        self.highlightText = nil
        self.scrollToMessageId = nil
        self._mode = State(initialValue: .historical)
        self.webSocketClient = webSocketClient
        if let ws = webSocketClient {
            _liveViewModel = StateObject(wrappedValue: SessionViewModel(webSocketClient: ws))
        } else {
            _liveViewModel = StateObject(wrappedValue: SessionViewModel(apiClient: APIClient()))
        }
    }

    /// Initialize for viewing a historical session by ID (iOS - from search results)
    public init(sessionId: String, highlightText: String? = nil, scrollToMessageId: String? = nil, webSocketClient: WebSocketClient? = nil) {
        self.session = nil
        self.sessionId = sessionId
        self.highlightText = highlightText
        self.scrollToMessageId = scrollToMessageId
        self._mode = State(initialValue: .historical)
        self.webSocketClient = webSocketClient
        if let ws = webSocketClient {
            _liveViewModel = StateObject(wrappedValue: SessionViewModel(webSocketClient: ws))
        } else {
            _liveViewModel = StateObject(wrappedValue: SessionViewModel(apiClient: APIClient()))
        }
    }
    #else
    /// Initialize for viewing a historical session (macOS)
    public init(
        sessionId: String,
        highlightText: String? = nil,
        scrollToMessageId: String? = nil,
        webSocketClient: WebSocketClient? = nil,
        onBack: @escaping () -> Void,
        onOpenInTerminal: ((String, String) -> Void)? = nil
    ) {
        self.session = nil
        self.sessionId = sessionId
        self.highlightText = highlightText
        self.scrollToMessageId = scrollToMessageId
        self.onBack = onBack
        self.onOpenInTerminal = onOpenInTerminal
        self._mode = State(initialValue: .historical)
        self.webSocketClient = webSocketClient
        if let ws = webSocketClient {
            _liveViewModel = StateObject(wrappedValue: SessionViewModel(webSocketClient: ws))
        } else {
            _liveViewModel = StateObject(wrappedValue: SessionViewModel(apiClient: APIClient()))
        }
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
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                if mode == .historical && webSocketClient != nil {
                    Button(action: { resumeSessionInstantly() }) {
                        Image(systemName: "arrow.clockwise.circle")
                    }
                    .help("Resume session")
                }

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

            HStack(spacing: 8) {
                if mode == .historical && webSocketClient != nil {
                    Button(action: { resumeSessionInstantly() }) {
                        Image(systemName: "arrow.clockwise.circle")
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.secondary)
                    .help("Resume session in app")
                }

                if mode == .historical && onOpenInTerminal != nil {
                    Button {
                        if let detail = sessionDetail {
                            onOpenInTerminal?(sessionId, detail.session.project)
                        }
                    } label: {
                        Image(systemName: "terminal")
                    }
                    .buttonStyle(.borderless)
                    .foregroundColor(.secondary)
                    .help("Open in iTerm2")
                }

                if let detail = sessionDetail {
                    Button(action: { copyConversation(detail) }) {
                        Image(systemName: "doc.on.doc")
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.secondary)
                    .help("Copy conversation")
                }
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
            // Live mode: show historical messages + live streaming messages
            VStack(spacing: 0) {
                // Historical messages (if any)
                if !detail.messages.isEmpty {
                    MessageListView(
                        messages: detail.messages,
                        session: detail.session,
                        highlightText: nil,
                        scrollToMessageId: nil,
                        style: style
                    )
                }

                // Live streaming messages
                if !liveViewModel.messages.isEmpty {
                    Divider()
                    Text("Live Session")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 4)
                    MessageListView(
                        messages: liveViewModel.messages,
                        session: detail.session,
                        highlightText: nil,
                        scrollToMessageId: nil,
                        style: style
                    )
                }

                // Status bar
                liveStatusBar
            }
        }
    }

    // MARK: - Live Status Bar

    @ViewBuilder
    private var liveStatusBar: some View {
        if liveViewModel.state == .running {
            HStack {
                ProgressView()
                    .controlSize(.small)
                Text("Claude is working...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") {
                    liveViewModel.cancel()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .tint(.red)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(statusBarBackground)
        } else if liveViewModel.state.canSendMessage {
            // Show input field for follow-up messages (works for both .ready and .idle states)
            HStack(spacing: 8) {
                TextField("Send a follow-up...", text: $followUpPrompt)
                    .textFieldStyle(.plain)
                    .padding(8)
                    .background(Color.primary.opacity(0.05))
                    .cornerRadius(8)
                    .onSubmit {
                        sendFollowUp()
                    }

                Button(action: sendFollowUp) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.blue)
                }
                .buttonStyle(.plain)
                .disabled(followUpPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(statusBarBackground)
        } else if case .completed(let exitCode) = liveViewModel.state {
            HStack {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(.orange)
                Text("Completed with exit code \(exitCode)")
                    .font(.caption)
                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(statusBarBackground)
        } else if let error = liveViewModel.error {
            HStack {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.red)
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(statusBarBackground)
        }
    }

    // MARK: - Platform-Specific Helpers

    private var statusBarBackground: Color {
        #if os(iOS)
        Color(.secondarySystemBackground)
        #else
        Color(NSColor.controlBackgroundColor)
        #endif
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


    /// Instantly switch to live mode for resuming a session.
    /// The user will see the input field and can type their follow-up message naturally.
    private func resumeSessionInstantly() {
        guard let detail = sessionDetail else { return }
        let workingDir = detail.session.project

        // Prepare viewModel for resume (sets resumeSessionId so sendMessage routes to sendFollowUp)
        liveViewModel.prepareForResumeSession(resumeSessionId: sessionId, workingDir: workingDir)

        // Switch to live mode - this will show the input field
        mode = .live
    }

    private func sendFollowUp() {
        let prompt = followUpPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }

        // Clear input immediately for responsiveness
        followUpPrompt = ""

        Task {
            do {
                // Use unified sendMessage() which handles both new sessions and follow-ups
                try await liveViewModel.sendMessage(prompt: prompt)
            } catch {
                self.error = error.localizedDescription
            }
        }
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

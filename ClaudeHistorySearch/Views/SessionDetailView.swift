import SwiftUI

struct SessionDetailView: View {
    @EnvironmentObject var apiClient: APIClient

    let session: Session?
    let sessionId: String?
    let highlightText: String?
    let scrollToMessageId: String?

    @State private var sessionDetail: SessionDetailResponse?
    @State private var isLoading = true
    @State private var error: String?

    init(session: Session) {
        self.session = session
        self.sessionId = session.id
        self.highlightText = nil
        self.scrollToMessageId = nil
    }

    init(sessionId: String, highlightText: String? = nil, scrollToMessageId: String? = nil) {
        self.session = nil
        self.sessionId = sessionId
        self.highlightText = highlightText
        self.scrollToMessageId = scrollToMessageId
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading conversation...")
            } else if let error = error {
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
            } else if let detail = sessionDetail {
                conversationView(detail: detail)
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

    private var displayTitle: String {
        if let session = session {
            return session.projectName
        } else if let detail = sessionDetail {
            return detail.session.projectName
        }
        return "Conversation"
    }

    @ViewBuilder
    private func conversationView(detail: SessionDetailResponse) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    // Header
                    VStack(spacing: 8) {
                        Text(detail.session.project)
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(detail.session.startedAtDate, style: .date)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        Text("\(detail.messages.count) messages")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .padding()

                    Divider()

                    // Messages
                    ForEach(detail.messages) { message in
                        MessageBubbleView(message: message, highlightText: highlightText)
                            .id(message.uuid)
                    }

                    // Bottom padding
                    Spacer()
                        .frame(height: 50)
                }
            }
            .onAppear {
                if let targetId = scrollToMessageId {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        withAnimation {
                            proxy.scrollTo(targetId, anchor: .center)
                        }
                    }
                }
            }
        }
    }

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
        SessionDetailView(session: Session(
            id: "test-id",
            project: "/Users/test/Developer",
            startedAt: Int64(Date().timeIntervalSince1970 * 1000),
            messageCount: 5,
            preview: "Test preview"
        ))
        .environmentObject(APIClient())
    }
}

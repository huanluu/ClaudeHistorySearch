import SwiftUI
import ClaudeHistoryShared

struct SessionDetailView: View {
    @EnvironmentObject var apiClient: APIClient

    let sessionId: String
    let highlightText: String?
    let scrollToMessageId: String?
    let onBack: () -> Void

    @State private var sessionDetail: SessionDetailResponse?
    @State private var isLoading = true
    @State private var error: String?

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
                conversationView(detail: detail)
            } else {
                Text("No data available")
                    .foregroundColor(.secondary)
            }
        }
        .frame(width: 420, height: 500)
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
                Text(detail.session.projectName)
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

    // MARK: - Conversation View

    private func conversationView(detail: SessionDetailResponse) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    // Session info
                    VStack(spacing: 4) {
                        Text(detail.session.startedAtDate, style: .date)
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text("\(detail.messages.count) messages")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 12)

                    Divider()
                        .padding(.horizontal)

                    // Messages
                    ForEach(detail.messages) { message in
                        MessageRowView(message: message, highlightText: highlightText)
                            .id(message.uuid)
                    }

                    // Bottom padding
                    Spacer()
                        .frame(height: 20)
                }
            }
            .onAppear {
                if let targetId = scrollToMessageId {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        withAnimation {
                            proxy.scrollTo(targetId, anchor: .center)
                        }
                    }
                }
            }
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

        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

#Preview {
    SessionDetailView(
        sessionId: "test",
        highlightText: "SwiftUI",
        scrollToMessageId: nil,
        onBack: {}
    )
    .environmentObject(APIClient())
}

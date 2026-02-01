import SwiftUI

/// A shared component for displaying a list of session messages.
/// Supports scroll-to-message functionality and text highlighting.
public struct MessageListView: View {
    public let messages: [Message]
    public let session: Session?
    public let highlightText: String?
    public let scrollToMessageId: String?
    public let style: MessageRowStyle

    public init(
        messages: [Message],
        session: Session? = nil,
        highlightText: String? = nil,
        scrollToMessageId: String? = nil,
        style: MessageRowStyle = .default
    ) {
        self.messages = messages
        self.session = session
        self.highlightText = highlightText
        self.scrollToMessageId = scrollToMessageId
        self.style = style
    }

    public var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    // Session header (if session provided)
                    if let session = session {
                        sessionHeader(session)

                        Divider()
                            .padding(.horizontal, style.isCompact ? 12 : 0)
                    }

                    // Messages
                    ForEach(messages) { message in
                        MessageRow(message: message, highlightText: highlightText, style: style)
                            .id(message.uuid)
                    }

                    // Bottom padding
                    Spacer()
                        .frame(height: style.isCompact ? 20 : 50)
                }
            }
            .onAppear {
                scrollToTarget(proxy: proxy)
            }
        }
    }

    // MARK: - Session Header

    @ViewBuilder
    private func sessionHeader(_ session: Session) -> some View {
        VStack(spacing: style.isCompact ? 4 : 8) {
            Text(session.project)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(1)

            Text(session.startedAtDate, style: .date)
                .font(style.isCompact ? .caption : .caption2)
                .foregroundColor(.secondary)

            Text("\(messages.count) messages")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, style.isCompact ? 12 : 16)
        .padding(.horizontal, style.isCompact ? 12 : 16)
    }

    // MARK: - Scroll Support

    private func scrollToTarget(proxy: ScrollViewProxy) {
        guard let targetId = scrollToMessageId else { return }

        let delay = style.isCompact ? 0.3 : 0.5
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            withAnimation {
                proxy.scrollTo(targetId, anchor: .center)
            }
        }
    }
}

#Preview {
    MessageListView(
        messages: [
            Message(
                uuid: "1",
                role: "user",
                content: "Hello, how are you?",
                timestamp: Int64(Date().timeIntervalSince1970 * 1000)
            ),
            Message(
                uuid: "2",
                role: "assistant",
                content: "I'm doing well! How can I help you today?",
                timestamp: Int64(Date().timeIntervalSince1970 * 1000)
            )
        ],
        session: Session(
            id: "test",
            project: "/Users/test/Developer/MyProject",
            startedAt: Int64(Date().timeIntervalSince1970 * 1000),
            messageCount: 2,
            preview: "Hello"
        )
    )
    .frame(width: 400, height: 500)
}

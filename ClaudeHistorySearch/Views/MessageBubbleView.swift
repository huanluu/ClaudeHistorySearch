import SwiftUI
import ClaudeHistoryShared

struct MessageBubbleView: View {
    let message: Message
    let highlightText: String?

    init(message: Message, highlightText: String? = nil) {
        self.message = message
        self.highlightText = highlightText
    }

    var body: some View {
        HStack {
            if message.isUser {
                Spacer(minLength: 60)
            }

            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 4) {
                Text(message.isUser ? "You" : "Claude")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text(attributedContent)
                    .padding(12)
                    .background(message.isUser ? Color.blue : Color(.systemGray5))
                    .foregroundColor(message.isUser ? .white : .primary)
                    .cornerRadius(16)
                    .textSelection(.enabled)

                if let date = message.timestampDate {
                    Text(date, style: .time)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            if message.isAssistant {
                Spacer(minLength: 60)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 4)
    }

    private var attributedContent: AttributedString {
        var content = message.content

        // Truncate very long messages for performance
        if content.count > 5000 {
            content = String(content.prefix(5000)) + "...\n\n[Message truncated]"
        }

        var attributedString = AttributedString(content)

        // Highlight search term if present
        if let highlight = highlightText?.lowercased(), !highlight.isEmpty {
            let lowercasedContent = content.lowercased()
            var searchStart = lowercasedContent.startIndex

            while let range = lowercasedContent.range(of: highlight, range: searchStart..<lowercasedContent.endIndex) {
                let attrRange = AttributedString.Index(range.lowerBound, within: attributedString)!
                    ..< AttributedString.Index(range.upperBound, within: attributedString)!
                attributedString[attrRange].backgroundColor = .yellow
                attributedString[attrRange].foregroundColor = .black
                searchStart = range.upperBound
            }
        }

        return attributedString
    }
}

#Preview {
    VStack {
        MessageBubbleView(message: Message(
            uuid: "1",
            role: "user",
            content: "How do I create a SwiftUI app?",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        ))

        MessageBubbleView(message: Message(
            uuid: "2",
            role: "assistant",
            content: "To create a SwiftUI app, you'll need Xcode 15 or later. Start by creating a new project and selecting the SwiftUI App template.",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        ), highlightText: "SwiftUI")
    }
}

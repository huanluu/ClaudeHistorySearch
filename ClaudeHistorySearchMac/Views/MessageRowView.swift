import SwiftUI
import ClaudeHistoryShared

struct MessageRowView: View {
    let message: Message
    let highlightText: String?

    init(message: Message, highlightText: String? = nil) {
        self.message = message
        self.highlightText = highlightText
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.isUser {
                Spacer(minLength: 40)
            }

            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 4) {
                // Role label
                HStack(spacing: 4) {
                    if message.isAssistant {
                        Image(systemName: "bubble.left.fill")
                            .font(.caption2)
                            .foregroundColor(.gray)
                    }
                    Text(message.isUser ? "You" : "Claude")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    if message.isUser {
                        Image(systemName: "person.fill")
                            .font(.caption2)
                            .foregroundColor(.blue)
                    }
                }

                // Message bubble
                Text(attributedContent)
                    .font(.system(size: 13))
                    .padding(10)
                    .background(message.isUser ? Color.blue : Color(nsColor: .controlBackgroundColor))
                    .foregroundColor(message.isUser ? .white : .primary)
                    .cornerRadius(12)
                    .textSelection(.enabled)
                    .frame(maxWidth: 320, alignment: message.isUser ? .trailing : .leading)

                // Timestamp
                if let date = message.timestampDate {
                    Text(date, style: .time)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            if message.isAssistant {
                Spacer(minLength: 40)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private var attributedContent: AttributedString {
        var content = message.content

        // Truncate very long messages for performance
        if content.count > 3000 {
            content = String(content.prefix(3000)) + "...\n\n[Message truncated]"
        }

        var attributedString = AttributedString(content)

        // Highlight search term if present
        if let highlight = highlightText?.lowercased(), !highlight.isEmpty {
            let lowercasedContent = content.lowercased()
            var searchStart = lowercasedContent.startIndex

            while let range = lowercasedContent.range(of: highlight, range: searchStart..<lowercasedContent.endIndex) {
                if let attrStart = AttributedString.Index(range.lowerBound, within: attributedString),
                   let attrEnd = AttributedString.Index(range.upperBound, within: attributedString) {
                    attributedString[attrStart..<attrEnd].backgroundColor = .yellow
                    attributedString[attrStart..<attrEnd].foregroundColor = .black
                }
                searchStart = range.upperBound
            }
        }

        return attributedString
    }
}

#Preview {
    VStack(spacing: 0) {
        MessageRowView(message: Message(
            uuid: "1",
            role: "user",
            content: "How do I create a SwiftUI menu bar app?",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        ))

        MessageRowView(message: Message(
            uuid: "2",
            role: "assistant",
            content: "To create a SwiftUI menu bar app, you'll need to use MenuBarExtra which was introduced in macOS 13. Here's a basic example:\n\n```swift\n@main\nstruct MyApp: App {\n    var body: some Scene {\n        MenuBarExtra {\n            ContentView()\n        } label: {\n            Image(systemName: \"star\")\n        }\n    }\n}\n```",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        ), highlightText: "SwiftUI")

        MessageRowView(message: Message(
            uuid: "3",
            role: "user",
            content: "Thanks! That's very helpful.",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        ))
    }
    .frame(width: 420)
    .padding()
}

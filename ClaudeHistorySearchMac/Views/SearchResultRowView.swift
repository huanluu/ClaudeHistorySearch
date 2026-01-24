import SwiftUI
import ClaudeHistoryShared

struct SearchResultRowView: View {
    let result: SearchResult
    let query: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 10) {
                // Role icon
                Image(systemName: result.message.isUser ? "person.fill" : "bubble.left.fill")
                    .foregroundColor(result.message.isUser ? .blue : .gray)
                    .font(.system(size: 14))
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 4) {
                    // Project name and date
                    HStack {
                        Text(result.projectName)
                            .font(.headline)
                            .lineLimit(1)
                        Spacer()
                        Text(result.startedAtDate, style: .date)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    // Preview with highlighting
                    Text(highlightedPreview)
                        .font(.subheadline)
                        .lineLimit(2)
                        .foregroundColor(.primary)
                }

                // Chevron
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(Color.primary.opacity(0.001)) // For hover detection
    }

    private var highlightedPreview: AttributedString {
        let content = String(result.message.content.prefix(150))
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        var attributedString = AttributedString(content)

        let lowercasedContent = content.lowercased()
        let lowercasedQuery = query.lowercased()
        var searchStart = lowercasedContent.startIndex

        while let range = lowercasedContent.range(of: lowercasedQuery, range: searchStart..<lowercasedContent.endIndex) {
            if let attrStart = AttributedString.Index(range.lowerBound, within: attributedString),
               let attrEnd = AttributedString.Index(range.upperBound, within: attributedString) {
                attributedString[attrStart..<attrEnd].backgroundColor = .yellow
                attributedString[attrStart..<attrEnd].foregroundColor = .black
            }
            searchStart = range.upperBound
        }

        return attributedString
    }
}

#Preview {
    VStack(spacing: 0) {
        SearchResultRowView(
            result: SearchResult(
                sessionId: "1",
                project: "/Users/test/MyProject",
                sessionStartedAt: Int64(Date().timeIntervalSince1970 * 1000),
                message: Message(
                    uuid: "1",
                    role: "user",
                    content: "How do I create a SwiftUI app with a menu bar?",
                    timestamp: Int64(Date().timeIntervalSince1970 * 1000)
                )
            ),
            query: "SwiftUI",
            onTap: {}
        )
        Divider()
        SearchResultRowView(
            result: SearchResult(
                sessionId: "2",
                project: "/Users/test/AnotherProject",
                sessionStartedAt: Int64(Date().timeIntervalSince1970 * 1000),
                message: Message(
                    uuid: "2",
                    role: "assistant",
                    content: "To create a SwiftUI menu bar app, you'll need to use MenuBarExtra which was introduced in macOS 13.",
                    timestamp: Int64(Date().timeIntervalSince1970 * 1000)
                )
            ),
            query: "SwiftUI",
            onTap: {}
        )
    }
    .frame(width: 420)
}

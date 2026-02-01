import SwiftUI

/// Shared content for displaying a search result in a list.
/// Platform-specific code wraps this with NavigationLink (iOS) or Button (macOS).
public struct SearchResultRowContent: View {
    public let result: SearchResult
    public let query: String
    public let style: SearchResultRowStyle

    public init(result: SearchResult, query: String, style: SearchResultRowStyle = .default) {
        self.result = result
        self.query = query
        self.style = style
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Role icon (optional)
            if style.showIcon {
                Image(systemName: result.message.isUser ? "person.fill" : "bubble.left.fill")
                    .foregroundColor(result.message.isUser ? .blue : .gray)
                    .font(.system(size: 14))
                    .frame(width: 20)
            }

            VStack(alignment: .leading, spacing: style.verticalSpacing) {
                // Header row
                HStack {
                    if !style.showIcon {
                        // Show role inline if no icon
                        Image(systemName: result.message.isUser ? "person.fill" : "bubble.left.fill")
                            .foregroundColor(result.message.isUser ? .blue : .gray)
                        Text(result.message.isUser ? "You" : "Claude")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        // Show session name
                        Text(result.displayName)
                            .font(.headline)
                            .lineLimit(1)
                    }
                    Spacer()
                    Text(result.startedAtDate, style: .date)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                // Preview with highlighting
                Text(highlightedPreview)
                    .font(.subheadline)
                    .lineLimit(style.previewLines)
                    .foregroundColor(.primary)
            }

            // Chevron (optional)
            if style.showChevron {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, style.horizontalPadding)
        .padding(.vertical, style.verticalPadding)
        .contentShape(Rectangle())
    }

    private var highlightedPreview: AttributedString {
        let maxLength = style.showIcon ? 150 : 200
        let content = String(result.message.content.prefix(maxLength))
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

// MARK: - Style Configuration

public struct SearchResultRowStyle: Equatable {
    public let showIcon: Bool
    public let showChevron: Bool
    public let horizontalPadding: CGFloat
    public let verticalPadding: CGFloat
    public let verticalSpacing: CGFloat
    public let previewLines: Int

    public init(
        showIcon: Bool = false,
        showChevron: Bool = false,
        horizontalPadding: CGFloat = 0,
        verticalPadding: CGFloat = 4,
        verticalSpacing: CGFloat = 6,
        previewLines: Int = 3
    ) {
        self.showIcon = showIcon
        self.showChevron = showChevron
        self.horizontalPadding = horizontalPadding
        self.verticalPadding = verticalPadding
        self.verticalSpacing = verticalSpacing
        self.previewLines = previewLines
    }

    /// Default style for iOS (inside NavigationLink)
    public static let `default` = SearchResultRowStyle()

    /// Compact style for macOS popover
    public static let compact = SearchResultRowStyle(
        showIcon: true,
        showChevron: true,
        horizontalPadding: 12,
        verticalPadding: 10,
        verticalSpacing: 4,
        previewLines: 2
    )
}

#Preview {
    VStack(spacing: 0) {
        SearchResultRowContent(
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
            style: .default
        )
        Divider()
        SearchResultRowContent(
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
            style: .compact
        )
    }
    .frame(width: 400)
    .padding()
}

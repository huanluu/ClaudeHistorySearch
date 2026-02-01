import SwiftUI

/// A unified message row component for displaying chat messages.
/// Works on both iOS and macOS with platform-appropriate styling.
public struct MessageRow: View {
    public let message: Message
    public let highlightText: String?
    public let style: MessageRowStyle

    public init(message: Message, highlightText: String? = nil, style: MessageRowStyle = .default) {
        self.message = message
        self.highlightText = highlightText
        self.style = style
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.isUser {
                Spacer(minLength: style.minSpacerWidth)
            }

            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 4) {
                // Role label
                roleLabel

                // Message bubble
                messageBubble

                // Timestamp
                if let date = message.timestampDate {
                    Text(date, style: .time)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            if message.isAssistant {
                Spacer(minLength: style.minSpacerWidth)
            }
        }
        .padding(.horizontal, style.horizontalPadding)
        .padding(.vertical, style.verticalPadding)
    }

    // MARK: - Role Label

    @ViewBuilder
    private var roleLabel: some View {
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
    }

    // MARK: - Message Bubble

    @ViewBuilder
    private var messageBubble: some View {
        Text(attributedContent)
            .font(.system(size: style.fontSize))
            .padding(style.bubblePadding)
            .background(bubbleBackground)
            .foregroundColor(message.isUser ? .white : .primary)
            .cornerRadius(style.cornerRadius)
            .textSelection(.enabled)
            .frame(maxWidth: style.maxBubbleWidth, alignment: message.isUser ? .trailing : .leading)
    }

    private var bubbleBackground: Color {
        if message.isUser {
            return .blue
        }
        #if os(macOS)
        return Color(nsColor: .controlBackgroundColor)
        #else
        return Color(.systemGray5)
        #endif
    }

    // MARK: - Highlighted Content

    private var attributedContent: AttributedString {
        var content = message.content

        // Truncate very long messages for performance
        if content.count > style.maxContentLength {
            content = String(content.prefix(style.maxContentLength)) + "...\n\n[Message truncated]"
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

// MARK: - Style Configuration

/// Configuration for MessageRow appearance
public struct MessageRowStyle: Equatable {
    public let fontSize: CGFloat
    public let bubblePadding: CGFloat
    public let cornerRadius: CGFloat
    public let horizontalPadding: CGFloat
    public let verticalPadding: CGFloat
    public let minSpacerWidth: CGFloat
    public let maxBubbleWidth: CGFloat?
    public let maxContentLength: Int

    /// Whether this is the compact style (for conditional styling)
    public var isCompact: Bool {
        self == Self.compact
    }

    public init(
        fontSize: CGFloat = 14,
        bubblePadding: CGFloat = 12,
        cornerRadius: CGFloat = 16,
        horizontalPadding: CGFloat = 16,
        verticalPadding: CGFloat = 4,
        minSpacerWidth: CGFloat = 60,
        maxBubbleWidth: CGFloat? = nil,
        maxContentLength: Int = 5000
    ) {
        self.fontSize = fontSize
        self.bubblePadding = bubblePadding
        self.cornerRadius = cornerRadius
        self.horizontalPadding = horizontalPadding
        self.verticalPadding = verticalPadding
        self.minSpacerWidth = minSpacerWidth
        self.maxBubbleWidth = maxBubbleWidth
        self.maxContentLength = maxContentLength
    }

    /// Default style for iOS
    public static let `default` = MessageRowStyle()

    /// Compact style for macOS popover
    public static let compact = MessageRowStyle(
        fontSize: 13,
        bubblePadding: 10,
        cornerRadius: 12,
        horizontalPadding: 12,
        verticalPadding: 6,
        minSpacerWidth: 40,
        maxBubbleWidth: 320,
        maxContentLength: 3000
    )
}

#Preview {
    VStack(spacing: 0) {
        MessageRow(message: Message(
            uuid: "1",
            role: "user",
            content: "How do I create a SwiftUI app?",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        ))

        MessageRow(message: Message(
            uuid: "2",
            role: "assistant",
            content: "To create a SwiftUI app, you'll need Xcode 15 or later. Start by creating a new project and selecting the SwiftUI App template.",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        ), highlightText: "SwiftUI")
    }
    .padding()
}

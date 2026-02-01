import SwiftUI

/// Shared content for displaying a session in a list.
/// Platform-specific code wraps this with NavigationLink (iOS) or Button (macOS).
public struct SessionRowContent: View {
    public let session: Session
    public let style: SessionRowStyle

    public init(session: Session, style: SessionRowStyle = .default) {
        self.session = session
        self.style = style
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Chat icon
            if style.showIcon {
                Image(systemName: "bubble.left.and.bubble.right")
                    .foregroundColor(.blue)
                    .font(.system(size: 14))
                    .frame(width: 20)
            }

            VStack(alignment: .leading, spacing: 4) {
                // Session title and date
                HStack {
                    Text(session.displayName)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer()
                    Text(session.startedAtDate, style: .relative)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                // Project folder path (optional)
                if style.showProject {
                    Text(session.project)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                // Preview
                Text(session.preview)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(2)

                // Message count
                HStack(spacing: 4) {
                    Image(systemName: "message")
                        .font(.caption2)
                    Text("\(session.messageCount) messages")
                        .font(.caption2)
                }
                .foregroundColor(.secondary)
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
}

// MARK: - Style Configuration

public struct SessionRowStyle: Equatable {
    public let showIcon: Bool
    public let showProject: Bool
    public let showChevron: Bool
    public let horizontalPadding: CGFloat
    public let verticalPadding: CGFloat

    public init(
        showIcon: Bool = false,
        showProject: Bool = false,
        showChevron: Bool = false,
        horizontalPadding: CGFloat = 0,
        verticalPadding: CGFloat = 4
    ) {
        self.showIcon = showIcon
        self.showProject = showProject
        self.showChevron = showChevron
        self.horizontalPadding = horizontalPadding
        self.verticalPadding = verticalPadding
    }

    /// Default style for iOS (inside NavigationLink, no extra chrome)
    public static let `default` = SessionRowStyle()

    /// Compact style for macOS popover (with icon and chevron)
    public static let compact = SessionRowStyle(
        showIcon: true,
        showProject: true,
        showChevron: true,
        horizontalPadding: 12,
        verticalPadding: 10
    )
}

#Preview {
    VStack(spacing: 0) {
        SessionRowContent(
            session: Session(
                id: "1",
                project: "/Users/test/Developer/MyProject",
                startedAt: Int64(Date().timeIntervalSince1970 * 1000),
                messageCount: 15,
                preview: "How do I create a SwiftUI app?"
            ),
            style: .default
        )
        Divider()
        SessionRowContent(
            session: Session(
                id: "2",
                project: "/Users/test/Developer/AnotherProject",
                startedAt: Int64(Date().timeIntervalSince1970 * 1000),
                messageCount: 8,
                preview: "Can you help me debug this issue with my code?"
            ),
            style: .compact
        )
    }
    .frame(width: 400)
    .padding()
}

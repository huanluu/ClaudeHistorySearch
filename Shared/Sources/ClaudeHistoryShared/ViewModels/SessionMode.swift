import Foundation

/// Defines the mode a session view can operate in.
public enum SessionMode: Equatable {
    /// Viewing a historical session (read-only)
    case historical

    /// Active live session with streaming output
    case live

    /// Whether the session is interactive (can receive new input)
    public var isInteractive: Bool {
        switch self {
        case .historical:
            return false
        case .live:
            return true
        }
    }

    /// Whether the session is streaming output
    public var isStreaming: Bool {
        switch self {
        case .historical:
            return false
        case .live:
            return true
        }
    }
}

/// State of a live session
public enum SessionState: Equatable {
    /// Session not started
    case idle

    /// Session is running and streaming output
    case running

    /// Session completed successfully
    case completed(exitCode: Int)

    /// Session failed with error
    case error(String)

    /// Session was cancelled by user
    case cancelled

    /// Whether the session is currently active
    public var isActive: Bool {
        switch self {
        case .running:
            return true
        default:
            return false
        }
    }

    /// Whether the session has finished (success, error, or cancelled)
    public var isFinished: Bool {
        switch self {
        case .completed, .error, .cancelled:
            return true
        default:
            return false
        }
    }
}

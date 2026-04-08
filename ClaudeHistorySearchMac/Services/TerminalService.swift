import Foundation
import AppKit

/// Service for opening Claude sessions in terminal emulators (iTerm2 or Terminal.app)
@MainActor
class TerminalService {
    static let shared = TerminalService()

    private init() {}

    private let iTermBundleId = "com.googlecode.iterm2"

    /// Starts a new Claude session in iTerm2 with the office alias
    func startNewSession() throws {
        // Close the popover first so permission dialogs are visible
        NotificationCenter.default.post(name: Notification.Name("closePopover"), object: nil)

        let command = "office && claude"

        if isITerm2Available() {
            try executeInITerm2(command: command)
        } else {
            try executeInTerminal(command: command)
        }
    }

    /// CLI allowlist — maps session source to binary name and resume flags.
    /// Security: never use raw source string as a binary name.
    private let cliConfigs: [String: (binary: String, flags: String)] = [
        "claude": (binary: "claude", flags: "--dangerously-skip-permissions"),
        "copilot": (binary: "copilot", flags: "--allow-all-tools"),
    ]

    /// Opens iTerm2 (or Terminal.app fallback) with the correct CLI resume command
    func openSession(sessionId: String, workingDirectory: String, source: String? = nil) throws {
        // Close the popover first so permission dialogs are visible
        NotificationCenter.default.post(name: Notification.Name("closePopover"), object: nil)

        // Validate sessionId format (UUID with optional hyphens — reject shell metacharacters)
        guard sessionId.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }) else {
            throw NSError(domain: "TerminalService", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid session ID format"])
        }

        // Escape single quotes in the directory path for safe shell usage
        let escapedDir = workingDirectory.replacingOccurrences(of: "'", with: "'\\''")

        // Select CLI from allowlist (defaults to claude for unknown sources)
        let cli = cliConfigs[source ?? "claude"] ?? cliConfigs["claude"]!

        // Check if this is an Office enlistment (configured in Settings)
        let officeEnlistmentPath = UserDefaults.standard.string(forKey: "officeEnlistmentPath")
        let isOfficeEnlistment = officeEnlistmentPath.map { !$0.isEmpty && workingDirectory.contains($0) } ?? false

        // Build the command: optionally run 'office' first to prepare enlistment
        let addDirs = isOfficeEnlistment ? " --add-dir office-harness/ --add-dir office-harness/utilities/" : ""
        let resumeCommand = "\(cli.binary) --resume \(sessionId) \(cli.flags)\(addDirs)"
        let command: String
        if isOfficeEnlistment {
            command = "office && cd '\(escapedDir)' && \(resumeCommand)"
        } else {
            command = "cd '\(escapedDir)' && \(resumeCommand)"
        }

        if isITerm2Available() {
            try executeInITerm2(command: command)
        } else {
            try executeInTerminal(command: command)
        }
    }

    private func isITerm2Available() -> Bool {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: iTermBundleId) != nil
    }

    /// Smart iTerm2 layout: 3 vertical splits, then horizontal splits to fill a 3×2 grid, then new tab.
    private func executeInITerm2(command: String) throws {
        let escaped = command.replacingOccurrences(of: "\\", with: "\\\\")
                            .replacingOccurrences(of: "\"", with: "\\\"")
                            .replacingOccurrences(of: "\n", with: "\\n")
                            .replacingOccurrences(of: "\r", with: "\\r")
        // Layout strategy per tab:
        //   Sessions 1-3: split vertically (add columns)
        //   Sessions 4-6: split horizontally right-to-left (add rows)
        //   Session 7+:   new tab, repeat
        // Splitting right-to-left keeps unsplit session indices stable.
        let script = """
        tell application "iTerm2"
            activate
            if (count of windows) = 0 then
                create window with default profile
                tell current session of current window
                    write text "\(escaped)"
                end tell
            else
                set tabSessions to sessions of current tab of current window
                set n to count of tabSessions
                if n < 3 then
                    tell last item of tabSessions
                        set newSession to (split vertically with default profile)
                    end tell
                    tell newSession
                        select
                        write text "\(escaped)"
                    end tell
                else if n < 6 then
                    set targetIdx to 6 - n
                    tell item targetIdx of tabSessions
                        set newSession to (split horizontally with default profile)
                    end tell
                    tell newSession
                        select
                        write text "\(escaped)"
                    end tell
                else
                    tell current window
                        create tab with default profile
                    end tell
                    tell current session of current window
                        write text "\(escaped)"
                    end tell
                end if
            end if
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        let errorPipe = Pipe()
        process.standardError = errorPipe

        try process.run()
        process.waitUntilExit()

        if process.terminationStatus != 0 {
            let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let errorMessage = String(data: errorData, encoding: .utf8) ?? "Unknown error"
            throw NSError(
                domain: "TerminalService",
                code: Int(process.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: errorMessage]
            )
        }
    }

    private func executeInTerminal(command: String) throws {
        // Use osascript via Process
        let escaped = command.replacingOccurrences(of: "\\", with: "\\\\")
                            .replacingOccurrences(of: "\"", with: "\\\"")
                            .replacingOccurrences(of: "\n", with: "\\n")
                            .replacingOccurrences(of: "\r", with: "\\r")
        let script = """
        tell application "Terminal"
            activate
            do script "\(escaped)"
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        let errorPipe = Pipe()
        process.standardError = errorPipe

        try process.run()
        process.waitUntilExit()

        if process.terminationStatus != 0 {
            let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let errorMessage = String(data: errorData, encoding: .utf8) ?? "Unknown error"
            throw NSError(
                domain: "TerminalService",
                code: Int(process.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: errorMessage]
            )
        }
    }

}

import Foundation
import AppKit

/// Service for opening Claude sessions in terminal emulators (cmux, iTerm2, or Terminal.app)
@MainActor
class TerminalService {
    static let shared = TerminalService()

    private init() {}

    private let iTermBundleId = "com.googlecode.iterm2"
    private let cmuxPaths = [
        "/opt/homebrew/bin/cmux",
        "/usr/local/bin/cmux",
    ]
    private let logPath = "\(NSHomeDirectory())/Library/Logs/ClaudeHistorySearch/terminal-service.log"

    private struct CLIConfig {
        let binary: String
        let flags: String
    }

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
    private let cliConfigs: [String: CLIConfig] = [
        "claude": CLIConfig(binary: "claude", flags: "--permission-mode auto"),
        "copilot": CLIConfig(binary: "copilot", flags: "--allow-all-tools"),
    ]

    /// Opens cmux, iTerm2, or Terminal.app with the correct CLI resume command
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
        let resumeCommand = "\(cli.binary) --resume \(shellSingleQuoted(sessionId)) \(cli.flags)\(addDirs)"

        if cmuxExecutableURL() != nil {
            do {
                try openSessionInCmux(
                    command: resumeCommand,
                    workingDirectory: workingDirectory,
                    isOfficeEnlistment: isOfficeEnlistment
                )
                return
            } catch {
                appendLog("cmux failed; falling back error=\(error.localizedDescription)")
            }
        }

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

    private func cmuxExecutableURL() -> URL? {
        cmuxPaths.first { FileManager.default.isExecutableFile(atPath: $0) }
            .map { URL(fileURLWithPath: $0) }
    }

    private func openSessionInCmux(command: String, workingDirectory: String, isOfficeEnlistment: Bool) throws {
        appendLog("cmux resume requested cwd=\(workingDirectory) command=\(redactedResumeCommand(command))")
        let quotedDirectory = shellSingleQuoted(workingDirectory)
        let commandToRun = isOfficeEnlistment
            ? "office && cd \(quotedDirectory) && \(command)"
            : "cd \(quotedDirectory) && \(command)"
        try executeInCmuxAppleScript(command: commandToRun, workingDirectory: workingDirectory)
    }

    private func executeInCmuxAppleScript(command: String, workingDirectory: String) throws {
        let escapedCommand = appleScriptString(command)
        let escapedDirectory = appleScriptString(workingDirectory)
        let openCommand = appleScriptString("/usr/bin/open -a cmux \(shellSingleQuoted(workingDirectory))")
        let script = """
        tell application "cmux"
            activate
            set targetDirectory to "\(escapedDirectory)"
            set resumeCommand to "\(escapedCommand)"

            repeat with w in windows
                repeat with workspaceTab in tabs of w
                    repeat with terminalPanel in terminals of workspaceTab
                        if working directory of terminalPanel is targetDirectory then
                            select tab workspaceTab
                            activate window w
                            set newTerminal to split terminalPanel direction right
                            input text resumeCommand & return to newTerminal
                            return "opened"
                        end if
                    end repeat
                end repeat
            end repeat

            do shell script "\(openCommand)"
            delay 1

            repeat with w in windows
                repeat with workspaceTab in tabs of w
                    repeat with terminalPanel in terminals of workspaceTab
                        if working directory of terminalPanel is targetDirectory then
                            select tab workspaceTab
                            activate window w
                            input text resumeCommand & return to terminalPanel
                            return "opened"
                        end if
                    end repeat
                end repeat
            end repeat

            error "cmux workspace not found for " & targetDirectory
        end tell
        """

        let output = try runAppleScript(script)
        appendLog("cmux applescript output=\(output.trimmingCharacters(in: .whitespacesAndNewlines))")
    }

    private func runAppleScript(_ script: String) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()
        process.waitUntilExit()

        let output = String(data: outputPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let errorMessage = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        appendLog("osascript status=\(process.terminationStatus) stdout=\(output.trimmingCharacters(in: .whitespacesAndNewlines)) stderr=\(errorMessage.trimmingCharacters(in: .whitespacesAndNewlines))")

        if process.terminationStatus != 0 {
            throw NSError(
                domain: "TerminalService",
                code: Int(process.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: errorMessage.isEmpty ? "cmux AppleScript failed" : errorMessage]
            )
        }

        return output
    }

    private func appleScriptString(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
    }

    private func shellSingleQuoted(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    private func appendLog(_ message: String) {
        let line = "\(Date()) \(message)\n"
        guard let data = line.data(using: .utf8) else {
            return
        }

        let logURL = URL(fileURLWithPath: logPath)
        try? FileManager.default.createDirectory(
            at: logURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        if FileManager.default.fileExists(atPath: logPath),
           let handle = try? FileHandle(forWritingTo: logURL) {
            defer { try? handle.close() }
            try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: logURL, options: .atomic)
        }
    }

    private func redactedResumeCommand(_ command: String) -> String {
        command.replacingOccurrences(
            of: #"--resume[[:space:]]+[^[:space:]]+"#,
            with: "--resume <redacted>",
            options: .regularExpression
        )
    }

    private func workspaceName(for workingDirectory: String) -> String {
        let url = URL(fileURLWithPath: workingDirectory)
        let lastPathComponent = url.lastPathComponent
        return lastPathComponent.isEmpty ? workingDirectory : lastPathComponent
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

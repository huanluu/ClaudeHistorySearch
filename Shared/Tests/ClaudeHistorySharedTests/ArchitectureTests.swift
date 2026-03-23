import XCTest

/// Architecture enforcement tests for issue #73.
/// Scans Swift source files to prevent:
/// - Service construction in views (duplicate instances)
/// - ObservableObject/Published in services
final class ArchitectureTests: XCTestCase {

    // MARK: - Helpers

    /// Project root derived from this test file's location
    private static var projectRoot: URL {
        // This file: Shared/Tests/ClaudeHistorySharedTests/ArchitectureTests.swift
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // ClaudeHistorySharedTests/
            .deletingLastPathComponent() // Tests/
            .deletingLastPathComponent() // Shared/
            .deletingLastPathComponent() // ClaudeHistorySearch/ (project root)
    }

    /// Recursively find all .swift files under the given directory
    private func swiftFiles(under directory: URL) -> [URL] {
        let fm = FileManager.default
        guard let enumerator = fm.enumerator(at: directory, includingPropertiesForKeys: nil) else {
            return []
        }
        var result: [URL] = []
        for case let url as URL in enumerator {
            if url.pathExtension == "swift" {
                result.append(url)
            }
        }
        return result
    }

    /// Check if a file path is in an allowlisted location (app bootstrap, preview providers)
    private func isAllowlisted(_ url: URL) -> Bool {
        let path = url.path
        // App bootstrap files create services at the composition root
        if path.hasSuffix("ClaudeHistorySearchApp.swift") { return true }
        if path.hasSuffix("AppDelegate.swift") { return true }
        return false
    }

    /// Check if a line is inside a #Preview block or PreviewProvider
    private func isPreviewLine(_ line: String, inPreviewBlock: Bool) -> Bool {
        return inPreviewBlock
    }

    /// Scan file content for a pattern, excluding preview blocks
    private func scanForViolations(in content: String, patterns: [String]) -> [(line: Int, text: String, pattern: String)] {
        var violations: [(Int, String, String)] = []
        var inPreviewBlock = false
        var braceDepth = 0

        for (lineNum, line) in content.components(separatedBy: .newlines).enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Track #Preview blocks and PreviewProvider
            if trimmed.hasPrefix("#Preview") || trimmed.contains("PreviewProvider") {
                inPreviewBlock = true
                braceDepth = 0
            }

            if inPreviewBlock {
                braceDepth += line.filter({ $0 == "{" }).count
                braceDepth -= line.filter({ $0 == "}" }).count
                if braceDepth <= 0 && trimmed.contains("}") {
                    inPreviewBlock = false
                }
                continue
            }

            // Skip comment lines
            if trimmed.hasPrefix("//") || trimmed.hasPrefix("*") || trimmed.hasPrefix("///") {
                continue
            }

            // Check for violations (with word-boundary check to avoid false positives
            // like "setAPIClient(" matching the "APIClient(" pattern)
            for pattern in patterns {
                if let range = line.range(of: pattern) {
                    // Check that the character before the match is not a letter or digit
                    // (i.e., it's a word boundary — the pattern is a standalone token)
                    let isWordBoundary: Bool
                    if range.lowerBound == line.startIndex {
                        isWordBoundary = true
                    } else {
                        let charBefore = line[line.index(before: range.lowerBound)]
                        isWordBoundary = !charBefore.isLetter && !charBefore.isNumber
                    }
                    if isWordBoundary {
                        violations.append((lineNum + 1, trimmed, pattern))
                    }
                }
            }
        }

        return violations
    }

    // MARK: - Service Construction in Views

    /// AC: Zero `APIClient()`, `WebSocketClient()`, or `ServerDiscovery()` constructor calls
    /// in any file under **/Views/**
    func testViews_noServiceConstruction() throws {
        let servicePatterns = ["APIClient(", "WebSocketClient(", "ServerDiscovery("]
        let projectRoot = Self.projectRoot

        // Scan all Views/ directories
        let viewsDirs = [
            projectRoot.appendingPathComponent("Shared/Sources/ClaudeHistoryShared/Views"),
            projectRoot.appendingPathComponent("ClaudeHistorySearch/Views"),
            projectRoot.appendingPathComponent("ClaudeHistorySearchMac/Views"),
        ]

        var allViolations: [(file: String, line: Int, text: String, pattern: String)] = []

        for dir in viewsDirs {
            for file in swiftFiles(under: dir) {
                guard !isAllowlisted(file) else { continue }
                let content = try String(contentsOf: file, encoding: .utf8)
                let violations = scanForViolations(in: content, patterns: servicePatterns)
                for v in violations {
                    let relativePath = file.path.replacingOccurrences(of: projectRoot.path + "/", with: "")
                    allViolations.append((relativePath, v.0, v.1, v.2))
                }
            }
        }

        if !allViolations.isEmpty {
            let details = allViolations.map { "\($0.file):\($0.line) — \($0.pattern) in: \($0.text)" }
            XCTFail("Service construction found in Views:\n" + details.joined(separator: "\n"))
        }
    }

    /// AC: Architecture test also covers files outside Views/ that are not app bootstrap
    func testNonBootstrap_noServiceConstruction() throws {
        let servicePatterns = ["APIClient(", "WebSocketClient(", "ServerDiscovery("]
        let projectRoot = Self.projectRoot

        // Scan ViewModels — these should receive services via injection, not construct them
        let viewModelDirs = [
            projectRoot.appendingPathComponent("Shared/Sources/ClaudeHistoryShared/ViewModels"),
        ]

        var allViolations: [(file: String, line: Int, text: String, pattern: String)] = []

        for dir in viewModelDirs {
            for file in swiftFiles(under: dir) {
                guard !isAllowlisted(file) else { continue }
                let content = try String(contentsOf: file, encoding: .utf8)
                let violations = scanForViolations(in: content, patterns: servicePatterns)
                for v in violations {
                    let relativePath = file.path.replacingOccurrences(of: projectRoot.path + "/", with: "")
                    allViolations.append((relativePath, v.0, v.1, v.2))
                }
            }
        }

        if !allViolations.isEmpty {
            let details = allViolations.map { "\($0.file):\($0.line) — \($0.pattern) in: \($0.text)" }
            XCTFail("Service construction found in non-bootstrap files:\n" + details.joined(separator: "\n"))
        }
    }

    // MARK: - Service Layer Boundaries

    /// AC: Services must not conform to ObservableObject or use @Published
    /// (allowlist: ServerDiscovery, which is the connection state model)
    func testServices_noObservableObject() throws {
        let projectRoot = Self.projectRoot
        let servicesDir = projectRoot.appendingPathComponent("Shared/Sources/ClaudeHistoryShared/Services")

        let allowlist = ["ServerDiscovery.swift"]

        var allViolations: [(file: String, line: Int, text: String, pattern: String)] = []

        for file in swiftFiles(under: servicesDir) {
            let filename = file.lastPathComponent
            guard !allowlist.contains(filename) else { continue }

            let content = try String(contentsOf: file, encoding: .utf8)
            let patterns = [": ObservableObject", "@Published"]
            let violations = scanForViolations(in: content, patterns: patterns)
            for v in violations {
                allViolations.append((filename, v.0, v.1, v.2))
            }
        }

        if !allViolations.isEmpty {
            let details = allViolations.map { "\($0.file):\($0.line) — \($0.pattern) in: \($0.text)" }
            XCTFail("ObservableObject/Published found in services:\n" + details.joined(separator: "\n"))
        }
    }

    /// AC: No concrete service types as init parameters in Shared package views
    func testSharedViews_noConcreteServiceParams() throws {
        let projectRoot = Self.projectRoot
        let sharedViewsDir = projectRoot.appendingPathComponent("Shared/Sources/ClaudeHistoryShared/Views")

        let concreteServiceTypes = [
            "apiClient: APIClient",
            "webSocketClient: WebSocketClient",
            "serverDiscovery: ServerDiscovery",
        ]

        var allViolations: [(file: String, line: Int, text: String, pattern: String)] = []

        for file in swiftFiles(under: sharedViewsDir) {
            let content = try String(contentsOf: file, encoding: .utf8)
            let violations = scanForViolations(in: content, patterns: concreteServiceTypes)
            for v in violations {
                // Exclude @EnvironmentObject and @Environment property declarations —
                // these are environment-injected, not init parameters
                let trimmedLine = v.1
                if trimmedLine.contains("@EnvironmentObject") || trimmedLine.contains("@Environment") {
                    continue
                }
                let filename = file.lastPathComponent
                allViolations.append((filename, v.0, v.1, v.2))
            }
        }

        if !allViolations.isEmpty {
            let details = allViolations.map { "\($0.file):\($0.line) — \($0.pattern) in: \($0.text)" }
            XCTFail("Concrete service types in Shared view init params:\n" + details.joined(separator: "\n"))
        }
    }
}

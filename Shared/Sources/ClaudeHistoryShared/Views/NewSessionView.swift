import SwiftUI

/// View for starting a new Claude session.
/// Provides prompt input and working directory selection.
public struct NewSessionView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: SessionViewModel

    @State private var prompt: String = ""
    @State private var workingDir: String = ""
    @State private var showingDirectoryPicker = false

    private let webSocketClient: WebSocketClient

    public init(webSocketClient: WebSocketClient) {
        self.webSocketClient = webSocketClient
        _viewModel = StateObject(wrappedValue: SessionViewModel(webSocketClient: webSocketClient))
    }

    public var body: some View {
        #if os(iOS)
        NavigationStack {
            formContent
                .navigationTitle("New Session")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            if viewModel.state == .running {
                                viewModel.cancel()
                            }
                            dismiss()
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        startButton
                    }
                }
        }
        #else
        VStack(spacing: 0) {
            macOSHeader
            Divider()
            formContent
        }
        .frame(width: 400, height: 350)
        #endif
    }

    // MARK: - Form Content

    private var formContent: some View {
        Form {
            Section {
                promptEditor
            } header: {
                Text("Prompt")
            } footer: {
                Text("Enter your message for Claude")
            }

            Section {
                workingDirField
            } header: {
                Text("Working Directory")
            } footer: {
                Text("The directory where Claude will execute commands")
            }

            if viewModel.state == .running {
                Section {
                    runningStatusView
                }
            }

            if case .completed(let exitCode) = viewModel.state {
                Section {
                    completedStatusView(exitCode: exitCode)
                }
            }

            if let error = viewModel.error {
                Section {
                    errorView(error)
                }
            }

            if !viewModel.messages.isEmpty {
                Section("Output") {
                    messagesView
                }
            }
        }
        #if os(iOS)
        .formStyle(.grouped)
        #endif
    }

    // MARK: - Prompt Editor

    private var promptEditor: some View {
        #if os(iOS)
        TextEditor(text: $prompt)
            .frame(minHeight: 100)
            .disabled(viewModel.state == .running)
        #else
        TextEditor(text: $prompt)
            .frame(minHeight: 80)
            .font(.body)
            .disabled(viewModel.state == .running)
        #endif
    }

    // MARK: - Working Directory Field

    private var workingDirField: some View {
        #if os(iOS)
        TextField("e.g., ~/Developer/MyProject", text: $workingDir)
            .textContentType(.URL)
            .autocapitalization(.none)
            .disabled(viewModel.state == .running)
        #else
        HStack {
            TextField("Working Directory", text: $workingDir)
                .textFieldStyle(.roundedBorder)
                .disabled(viewModel.state == .running)

            Button("Browse...") {
                selectDirectory()
            }
            .disabled(viewModel.state == .running)
        }
        #endif
    }

    // MARK: - Status Views

    private var runningStatusView: some View {
        HStack {
            ProgressView()
                .controlSize(.small)
            Text("Claude is working...")
                .foregroundStyle(.secondary)
            Spacer()
            Button("Cancel") {
                viewModel.cancel()
            }
            .buttonStyle(.bordered)
            .tint(.red)
        }
    }

    private func completedStatusView(exitCode: Int) -> some View {
        HStack {
            Image(systemName: exitCode == 0 ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .foregroundStyle(exitCode == 0 ? .green : .orange)
            Text(exitCode == 0 ? "Completed successfully" : "Completed with exit code \(exitCode)")
            Spacer()
        }
    }

    private func errorView(_ error: String) -> some View {
        HStack {
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
            Text(error)
                .foregroundStyle(.red)
            Spacer()
        }
    }

    private var messagesView: some View {
        ForEach(viewModel.messages, id: \.uuid) { message in
            VStack(alignment: .leading, spacing: 4) {
                Text(message.role == "human" ? "You" : "Claude")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                Text(message.content)
                    .font(.body)
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: - Start Button

    private var startButton: some View {
        Button("Start") {
            startSession()
        }
        .disabled(!canStart)
    }

    private var canStart: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !workingDir.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        viewModel.state != .running
    }

    // MARK: - macOS Header

    #if os(macOS)
    private var macOSHeader: some View {
        HStack {
            Button("Cancel") {
                if viewModel.state == .running {
                    viewModel.cancel()
                }
                dismiss()
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)

            Spacer()

            Text("New Session")
                .font(.headline)

            Spacer()

            startButton
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private func selectDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false

        if panel.runModal() == .OK, let url = panel.url {
            workingDir = url.path
        }
    }
    #endif

    // MARK: - Actions

    private func startSession() {
        guard canStart else { return }

        Task {
            do {
                try await viewModel.startSession(
                    prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines),
                    workingDir: expandTilde(workingDir.trimmingCharacters(in: .whitespacesAndNewlines))
                )
            } catch {
                // Error is already handled by viewModel.error
            }
        }
    }

    /// Expand ~ to home directory
    private func expandTilde(_ path: String) -> String {
        if path.hasPrefix("~") {
            return NSString(string: path).expandingTildeInPath
        }
        return path
    }
}

#if DEBUG
#Preview {
    NewSessionView(webSocketClient: WebSocketClient())
}
#endif

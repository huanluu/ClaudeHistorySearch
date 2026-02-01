import SwiftUI

/// View for starting a new Claude session.
/// Two-phase flow: (1) Select working directory, (2) Chat-like interface for messaging.
public struct NewSessionView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: SessionViewModel

    /// Phase tracking: false = setup phase, true = chat phase
    @State private var hasStarted = false

    /// Working directory input
    @State private var workingDir: String = "/Volumes/Office/Office2/src"

    /// Message input for chat phase
    @State private var messagePrompt: String = ""

    private let webSocketClient: WebSocketClient

    public init(webSocketClient: WebSocketClient) {
        self.webSocketClient = webSocketClient
        _viewModel = StateObject(wrappedValue: SessionViewModel(webSocketClient: webSocketClient))
    }

    public var body: some View {
        #if os(iOS)
        NavigationStack {
            Group {
                if hasStarted {
                    chatPhaseContent
                } else {
                    setupPhaseContent
                }
            }
            .navigationTitle(hasStarted ? "New Session" : "New Session")
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
                if !hasStarted {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Start") {
                            startChatPhase()
                        }
                        .disabled(!canStartChat)
                    }
                }
            }
        }
        #else
        VStack(spacing: 0) {
            macOSHeader
            Divider()
            if hasStarted {
                chatPhaseContent
            } else {
                setupPhaseContent
            }
        }
        .frame(width: 400, height: hasStarted ? 450 : 200)
        #endif
    }

    // MARK: - Setup Phase (Working Directory Selection)

    private var setupPhaseContent: some View {
        Form {
            Section {
                workingDirField
            } header: {
                Text("Working Directory")
            } footer: {
                Text("The directory where Claude will execute commands")
            }
        }
        #if os(iOS)
        .formStyle(.grouped)
        #endif
    }

    // MARK: - Chat Phase (Message Input)

    private var chatPhaseContent: some View {
        VStack(spacing: 0) {
            // Messages list
            if viewModel.messages.isEmpty && viewModel.state == .idle {
                // Empty state - waiting for first message
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 40))
                        .foregroundStyle(.secondary)
                    Text("Start the conversation")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text("Type your message below")
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
            } else {
                // Show messages
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(viewModel.messages, id: \.uuid) { message in
                                MessageBubble(message: message)
                                    .id(message.uuid)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: viewModel.messages.count) { _ in
                        if let lastMessage = viewModel.messages.last {
                            withAnimation {
                                proxy.scrollTo(lastMessage.uuid, anchor: .bottom)
                            }
                        }
                    }
                }
            }

            // Status bar when running
            if viewModel.state == .running {
                runningStatusView
            }

            // Error display
            if let error = viewModel.error {
                errorView(error)
            }

            Divider()

            // Input area
            chatInputArea
        }
    }

    // MARK: - Working Directory Field

    private var workingDirField: some View {
        #if os(iOS)
        TextField("e.g., ~/Developer/MyProject", text: $workingDir)
            .textContentType(.URL)
            .autocapitalization(.none)
        #else
        HStack {
            TextField("Working Directory", text: $workingDir)
                .textFieldStyle(.roundedBorder)

            Button("Browse...") {
                selectDirectory()
            }
        }
        #endif
    }

    // MARK: - Chat Input Area

    private var chatInputArea: some View {
        HStack(spacing: 8) {
            TextField("Message Claude...", text: $messagePrompt)
                .textFieldStyle(.plain)
                .padding(10)
                #if os(iOS)
                .background(Color(.secondarySystemBackground))
                #else
                .background(Color(NSColor.controlBackgroundColor))
                #endif
                .cornerRadius(20)
                .onSubmit {
                    sendMessage()
                }
                .disabled(viewModel.state == .running)

            Button(action: sendMessage) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(canSendMessage ? .blue : .gray)
            }
            .buttonStyle(.plain)
            .disabled(!canSendMessage)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    // MARK: - Status Views

    private var runningStatusView: some View {
        HStack {
            ProgressView()
                .controlSize(.small)
            Text("Claude is working...")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Cancel") {
                viewModel.cancel()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .tint(.red)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        #if os(iOS)
        .background(Color(.secondarySystemBackground))
        #else
        .background(Color(NSColor.controlBackgroundColor))
        #endif
    }

    private func errorView(_ error: String) -> some View {
        HStack {
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
            Text(error)
                .font(.caption)
                .foregroundStyle(.red)
            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    // MARK: - Message Bubble

    private struct MessageBubble: View {
        let message: Message

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(message.role == "user" ? "You" : "Claude")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(message.role == "user" ? .blue : .purple)
                    Spacer()
                }
                Text(message.content)
                    .font(.body)
                    .textSelection(.enabled)
            }
            .padding(12)
            #if os(iOS)
            .background(message.role == "user" ? Color(.systemBlue).opacity(0.1) : Color(.secondarySystemBackground))
            #else
            .background(message.role == "user" ? Color.blue.opacity(0.1) : Color(NSColor.controlBackgroundColor))
            #endif
            .cornerRadius(12)
        }
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

            if !hasStarted {
                Button("Start") {
                    startChatPhase()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(!canStartChat)
            } else {
                // Empty spacer to maintain layout
                Color.clear.frame(width: 50)
            }
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

    // MARK: - Validation

    private var canStartChat: Bool {
        !workingDir.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canSendMessage: Bool {
        !messagePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        viewModel.state != .running
    }

    // MARK: - Actions

    private func startChatPhase() {
        guard canStartChat else { return }

        let expandedDir = expandTilde(workingDir.trimmingCharacters(in: .whitespacesAndNewlines))
        viewModel.prepareForNewSession(workingDir: expandedDir)
        hasStarted = true
    }

    private func sendMessage() {
        let prompt = messagePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        guard viewModel.state != .running else { return }

        // Clear input immediately for responsiveness
        messagePrompt = ""

        Task {
            do {
                try await viewModel.sendMessage(prompt: prompt)
            } catch {
                // Error is handled by viewModel.error
                print("[NewSessionView] Error sending message: \(error)")
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

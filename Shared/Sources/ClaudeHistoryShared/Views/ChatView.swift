import SwiftUI

/// Chat interface for the assistant feature.
/// Pushes onto the existing NavigationStack — not a root view.
public struct ChatView: View {
    @Environment(\.webSocketClient) private var webSocketClient
    @StateObject private var viewModel = ChatViewModel()

    private let bottomID = "chat-bottom"

    #if os(macOS)
    private let onBack: () -> Void

    public init(onBack: @escaping () -> Void) {
        self.onBack = onBack
    }
    #else
    public init() {}
    #endif

    public var body: some View {
        #if os(macOS)
        macOSBody
        #else
        iOSBody
        #endif
    }

    // MARK: - iOS Layout

    #if os(iOS)
    private var iOSBody: some View {
        VStack(spacing: 0) {
            messagesArea
            Divider()
            inputArea
        }
        .navigationTitle("Assistant")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: { viewModel.newConversation() }) {
                    Image(systemName: "plus.message")
                }
            }
        }
        .onAppear {
            viewModel.configure(webSocketClient: webSocketClient)
            viewModel.startListening()
        }
        .onDisappear { viewModel.stopListening() }
    }
    #endif

    // MARK: - macOS Layout

    #if os(macOS)
    private var macOSBody: some View {
        VStack(spacing: 0) {
            macOSHeader
            Divider()
            messagesArea
            Divider()
            inputArea
        }
        .frame(width: 420, height: 500)
        .onAppear {
            viewModel.configure(webSocketClient: webSocketClient)
            viewModel.startListening()
        }
        .onDisappear { viewModel.stopListening() }
    }

    private var macOSHeader: some View {
        HStack {
            Button(action: onBack) {
                HStack(spacing: 2) {
                    Image(systemName: "chevron.left")
                    Text("Back")
                }
                .font(.system(size: 13))
            }
            .buttonStyle(.plain)
            .foregroundColor(.accentColor)

            Spacer()

            Text("Assistant")
                .font(.headline)

            Spacer()

            Button(action: { viewModel.newConversation() }) {
                Image(systemName: "plus.message")
                    .foregroundColor(.accentColor)
            }
            .buttonStyle(.plain)
            .help("New conversation")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
    #endif

    // MARK: - Messages Area

    private var messagesArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if viewModel.messages.isEmpty {
                    welcomeView
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(viewModel.messages) { message in
                            // Hide empty placeholder bubble (streaming assistant message before first delta)
                            if !message.content.isEmpty {
                                MessageRow(
                                    message: message,
                                    style: messageRowStyle
                                )
                            }
                        }

                        if viewModel.chatState == .streaming {
                            streamingIndicator
                        }

                        Color.clear
                            .frame(height: 1)
                            .id(bottomID)
                    }
                }
            }
            .onChange(of: viewModel.messages.count) { _ in
                withAnimation {
                    proxy.scrollTo(bottomID, anchor: .bottom)
                }
            }
            .onChange(of: viewModel.messages.last?.content.count) { _ in
                proxy.scrollTo(bottomID, anchor: .bottom)
            }
        }
    }

    private var messageRowStyle: MessageRowStyle {
        #if os(macOS)
        .compact
        #else
        .default
        #endif
    }

    // MARK: - Welcome View

    private var welcomeView: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "sparkles")
                .font(.system(size: 32))
                .foregroundColor(.secondary.opacity(0.6))
            Text("What can I help you with?")
                .font(.headline)
                .foregroundColor(.secondary)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Streaming Indicator

    private var streamingIndicator: some View {
        HStack {
            ProgressView()
                #if os(macOS)
                .controlSize(.small)
                #endif
            Text("Thinking...")
                .font(.caption)
                .foregroundColor(.secondary)
            Spacer()
        }
        .padding(.horizontal, messageRowStyle.horizontalPadding)
        .padding(.vertical, 8)
    }

    // MARK: - Input Area

    private var inputArea: some View {
        HStack(spacing: 8) {
            TextField("Message...", text: $viewModel.inputText)
                .textFieldStyle(.plain)
                .onSubmit { viewModel.sendMessage() }

            if viewModel.chatState == .streaming {
                Button(action: { viewModel.cancelResponse() }) {
                    Image(systemName: "stop.circle.fill")
                        .foregroundColor(.red)
                        .font(.system(size: 22))
                }
                .buttonStyle(.plain)
            } else {
                Button(action: { viewModel.sendMessage() }) {
                    Image(systemName: "arrow.up.circle.fill")
                        .foregroundColor(sendButtonColor)
                        .font(.system(size: 22))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var sendButtonColor: Color {
        viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? .secondary.opacity(0.5)
            : .accentColor
    }
}

import SwiftUI

/// Shared settings view for both iOS and macOS.
/// Uses conditional compilation for platform-specific styling.
public struct SettingsView: View {
    @ObservedObject var serverDiscovery: ServerDiscovery
    @ObservedObject var apiClient: APIClient
    @Environment(\.dismiss) var dismiss

    @State private var manualURL = ""
    @State private var apiKeyInput = ""
    @State private var showAPIKey = false
    @State private var apiKeyStatus: APIKeyStatus = .unknown

    public init(serverDiscovery: ServerDiscovery, apiClient: APIClient) {
        self.serverDiscovery = serverDiscovery
        self.apiClient = apiClient
    }

    enum APIKeyStatus {
        case unknown, saved, error(String)
    }

    public var body: some View {
        #if os(iOS)
        NavigationStack {
            formContent
                .navigationTitle("Settings")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        #else
        VStack(spacing: 0) {
            // macOS header
            HStack {
                Text("Settings")
                    .font(.headline)
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(.plain)
                    .foregroundColor(.accentColor)
            }
            .padding()

            Divider()

            formContent
                .formStyle(.grouped)
        }
        .frame(width: 350, height: 520)
        #endif
    }

    // MARK: - Form Content

    @ViewBuilder
    private var formContent: some View {
        Form {
            serverConnectionSection
            authenticationSection
            manualConnectionSection
            aboutSection
        }
    }

    // MARK: - Server Connection Section

    @ViewBuilder
    private var serverConnectionSection: some View {
        Section("Server Connection") {
            HStack {
                Text("Status")
                Spacer()
                HStack(spacing: 6) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 8, height: 8)
                    Text(serverDiscovery.connectionStatus.description)
                        .foregroundColor(.secondary)
                }
            }

            if let url = serverDiscovery.serverURL {
                HStack {
                    Text("URL")
                    Spacer()
                    Text(url.absoluteString)
                        .foregroundColor(.secondary)
                        .font(.caption)
                        .lineLimit(1)
                }
            }

            HStack {
                Button("Search for Server") {
                    serverDiscovery.startSearching()
                }
                .disabled(serverDiscovery.isSearching)

                if serverDiscovery.isSearching {
                    #if os(macOS)
                    ProgressView()
                        .scaleEffect(0.6)
                    #else
                    ProgressView()
                    #endif
                }
            }

            if serverDiscovery.serverURL != nil {
                Button("Disconnect") {
                    serverDiscovery.disconnect()
                }
                .foregroundColor(.red)
            }
        }
    }

    // MARK: - Authentication Section

    @ViewBuilder
    private var authenticationSection: some View {
        Section("Authentication") {
            HStack {
                Text("Status")
                Spacer()
                HStack(spacing: 6) {
                    Circle()
                        .fill(apiClient.isAuthenticated ? Color.green : Color.red)
                        .frame(width: 8, height: 8)
                    Text(apiClient.isAuthenticated ? "Authenticated" : "Not authenticated")
                        .foregroundColor(.secondary)
                }
            }

            HStack {
                #if os(iOS)
                if showAPIKey {
                    TextField("Enter API Key", text: $apiKeyInput)
                        .textContentType(.password)
                        .autocapitalization(.none)
                } else {
                    SecureField("Enter API Key", text: $apiKeyInput)
                }
                #else
                if showAPIKey {
                    TextField("Enter API Key", text: $apiKeyInput)
                        .textFieldStyle(.roundedBorder)
                } else {
                    SecureField("Enter API Key", text: $apiKeyInput)
                        .textFieldStyle(.roundedBorder)
                }
                #endif
                Button(action: { showAPIKey.toggle() }) {
                    Image(systemName: showAPIKey ? "eye.slash" : "eye")
                }
                #if os(macOS)
                .buttonStyle(.plain)
                #endif
            }

            HStack {
                Button("Save Key") {
                    saveAPIKey()
                }
                .disabled(apiKeyInput.isEmpty)

                if KeychainHelper.shared.hasAPIKey() {
                    Button("Clear Key") {
                        clearAPIKey()
                    }
                    .foregroundColor(.red)
                }
            }

            if case .error(let message) = apiKeyStatus {
                Text(message)
                    .foregroundColor(.red)
                    .font(.caption)
            } else if case .saved = apiKeyStatus {
                Text("API key saved")
                    .foregroundColor(.green)
                    .font(.caption)
            }
        }
    }

    // MARK: - Manual Connection Section

    @ViewBuilder
    private var manualConnectionSection: some View {
        Section("Manual Connection") {
            #if os(iOS)
            TextField("http://192.168.1.x:3847", text: $manualURL)
                .textContentType(.URL)
                .keyboardType(.URL)
                .autocapitalization(.none)
            #else
            TextField("http://localhost:3847", text: $manualURL)
                .textFieldStyle(.roundedBorder)
            #endif

            Button("Connect") {
                serverDiscovery.setManualURL(manualURL)
            }
            .disabled(manualURL.isEmpty)

            // Show last cached URL for easy reference/editing
            if let cachedURL = serverDiscovery.serverURL, manualURL.isEmpty {
                Text("Last: \(cachedURL.absoluteString)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .onTapGesture {
                        manualURL = cachedURL.absoluteString
                    }
            }
        }
        .onAppear {
            // Pre-fill with cached URL if empty
            if manualURL.isEmpty, let cached = serverDiscovery.serverURL {
                manualURL = cached.absoluteString
            }
        }
    }

    // MARK: - About Section

    @ViewBuilder
    private var aboutSection: some View {
        Section("About") {
            HStack {
                Text("Server Port")
                Spacer()
                Text("3847")
                    .foregroundColor(.secondary)
            }
            HStack {
                Text("Service Type")
                Spacer()
                Text("_claudehistory._tcp")
                    .foregroundColor(.secondary)
                    .font(.caption)
            }
        }
    }

    // MARK: - Helpers

    private var statusColor: Color {
        switch serverDiscovery.connectionStatus {
        case .connected: return .green
        case .searching: return .orange
        case .error: return .red
        case .disconnected: return .gray
        }
    }

    private func saveAPIKey() {
        do {
            try apiClient.saveAPIKeyToKeychain(apiKeyInput)
            apiKeyInput = ""
            apiKeyStatus = .saved
        } catch {
            apiKeyStatus = .error(error.localizedDescription)
        }
    }

    private func clearAPIKey() {
        do {
            try apiClient.clearAPIKey()
            apiKeyStatus = .unknown
        } catch {
            apiKeyStatus = .error(error.localizedDescription)
        }
    }
}

#Preview {
    SettingsView(
        serverDiscovery: ServerDiscovery(),
        apiClient: APIClient()
    )
}

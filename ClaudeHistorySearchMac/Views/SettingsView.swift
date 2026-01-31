import SwiftUI
import ClaudeHistoryShared

struct SettingsView: View {
    @EnvironmentObject var serverDiscovery: ServerDiscovery
    @EnvironmentObject var apiClient: APIClient
    @Environment(\.dismiss) var dismiss
    @State private var manualURL = ""
    @State private var apiKeyInput = ""
    @State private var showAPIKey = false
    @State private var apiKeyStatus: APIKeyStatus = .unknown

    enum APIKeyStatus {
        case unknown, saved, error(String)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Settings")
                    .font(.headline)
                Spacer()
                Button("Done") {
                    dismiss()
                }
                .buttonStyle(.plain)
                .foregroundColor(.accentColor)
            }
            .padding()

            Divider()

            Form {
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
                            ProgressView()
                                .scaleEffect(0.6)
                        }
                    }

                    if serverDiscovery.serverURL != nil {
                        Button("Disconnect") {
                            serverDiscovery.disconnect()
                        }
                        .foregroundColor(.red)
                    }
                }

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
                        if showAPIKey {
                            TextField("Enter API Key", text: $apiKeyInput)
                                .textFieldStyle(.roundedBorder)
                        } else {
                            SecureField("Enter API Key", text: $apiKeyInput)
                                .textFieldStyle(.roundedBorder)
                        }
                        Button(action: { showAPIKey.toggle() }) {
                            Image(systemName: showAPIKey ? "eye.slash" : "eye")
                        }
                        .buttonStyle(.plain)
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

                Section("Manual Connection") {
                    TextField("http://localhost:3847", text: $manualURL)
                        .textFieldStyle(.roundedBorder)

                    Button("Connect") {
                        serverDiscovery.setManualURL(manualURL)
                    }
                    .disabled(manualURL.isEmpty)
                }

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
            .formStyle(.grouped)
        }
        .frame(width: 350, height: 520)
    }

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
    SettingsView()
        .environmentObject(ServerDiscovery())
        .environmentObject(APIClient())
}

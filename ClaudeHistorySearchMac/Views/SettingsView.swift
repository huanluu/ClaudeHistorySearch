import SwiftUI
import ClaudeHistoryShared

struct SettingsView: View {
    @EnvironmentObject var serverDiscovery: ServerDiscovery
    @Environment(\.dismiss) var dismiss
    @State private var manualURL = ""

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
        .frame(width: 350, height: 400)
    }

    private var statusColor: Color {
        switch serverDiscovery.connectionStatus {
        case .connected: return .green
        case .searching: return .orange
        case .error: return .red
        case .disconnected: return .gray
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(ServerDiscovery())
}

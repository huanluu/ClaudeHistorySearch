import Foundation
import Network

@MainActor
public class ServerDiscovery: ObservableObject {
    @Published public var serverURL: URL?
    @Published public var isSearching = false
    @Published public var connectionStatus: ConnectionStatus = .disconnected

    public enum ConnectionStatus: Equatable, Sendable {
        case disconnected
        case searching
        case connected(String)
        case error(String)

        public var description: String {
            switch self {
            case .disconnected: return "Disconnected"
            case .searching: return "Searching..."
            case .connected(let host): return "Connected to \(host)"
            case .error(let message): return "Error: \(message)"
            }
        }

        public var isConnected: Bool {
            if case .connected = self { return true }
            return false
        }
    }

    private var browser: NWBrowser?
    private let serviceType = "_claudehistory._tcp"

    // UserDefaults key for cached server
    private let cachedURLKey = "cachedServerURL"

    public init() {
        // Try to restore cached server URL
        if let cached = UserDefaults.standard.string(forKey: cachedURLKey),
           let url = URL(string: cached) {
            self.serverURL = url
            self.connectionStatus = .connected(url.host ?? "unknown")
        }
    }

    public func startSearching() {
        guard browser == nil else { return }

        isSearching = true
        connectionStatus = .searching

        let parameters = NWParameters()
        parameters.includePeerToPeer = true

        browser = NWBrowser(for: .bonjour(type: serviceType, domain: "local."), using: parameters)

        browser?.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                switch state {
                case .failed(let error):
                    self?.connectionStatus = .error(error.localizedDescription)
                    self?.isSearching = false
                case .cancelled:
                    self?.isSearching = false
                default:
                    break
                }
            }
        }

        browser?.browseResultsChangedHandler = { [weak self] results, changes in
            Task { @MainActor in
                for result in results {
                    if case .service(let name, let type, let domain, _) = result.endpoint {
                        print("Found service: \(name) \(type) \(domain)")
                        self?.resolveService(result: result)
                    }
                }
            }
        }

        browser?.start(queue: .main)
    }

    public func stopSearching() {
        browser?.cancel()
        browser = nil
        isSearching = false
    }

    private func resolveService(result: NWBrowser.Result) {
        let connection = NWConnection(to: result.endpoint, using: .tcp)

        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                switch state {
                case .ready:
                    if let endpoint = connection.currentPath?.remoteEndpoint,
                       case .hostPort(let host, let port) = endpoint {
                        let hostString: String
                        switch host {
                        case .ipv4(let addr):
                            hostString = "\(addr)"
                        case .ipv6(let addr):
                            hostString = "[\(addr)]"
                        case .name(let name, _):
                            hostString = name
                        @unknown default:
                            hostString = "localhost"
                        }
                        guard let url = URL(string: "http://\(hostString):\(port)") else {
                            print("Failed to create URL from host: \(hostString)")
                            connection.cancel()
                            return
                        }
                        self?.serverURL = url
                        self?.connectionStatus = .connected(hostString)
                        self?.isSearching = false

                        // Cache the URL
                        UserDefaults.standard.set(url.absoluteString, forKey: self?.cachedURLKey ?? "")

                        self?.stopSearching()
                    }
                    connection.cancel()
                case .failed(let error):
                    print("Connection failed: \(error)")
                    connection.cancel()
                default:
                    break
                }
            }
        }

        connection.start(queue: .main)
    }

    public func setManualURL(_ urlString: String) {
        guard let url = URL(string: urlString) else {
            connectionStatus = .error("Invalid URL")
            return
        }
        serverURL = url
        connectionStatus = .connected(url.host ?? "unknown")
        UserDefaults.standard.set(url.absoluteString, forKey: cachedURLKey)
    }

    public func disconnect() {
        serverURL = nil
        connectionStatus = .disconnected
        UserDefaults.standard.removeObject(forKey: cachedURLKey)
    }
}

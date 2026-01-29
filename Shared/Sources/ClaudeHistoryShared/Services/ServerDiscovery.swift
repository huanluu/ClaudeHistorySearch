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
    private var pendingConnection: NWConnection?
    private var searchTimeout: Task<Void, Never>?
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
                    self?.stopSearching()
                case .cancelled:
                    self?.isSearching = false
                case .ready:
                    print("Browser ready, waiting for services...")
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
                        return // Only try the first one
                    }
                }
            }
        }

        browser?.start(queue: .main)

        // Add a 10 second timeout
        searchTimeout = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            if self.isSearching {
                self.connectionStatus = .error("No server found")
                self.stopSearching()
            }
        }
    }

    public func stopSearching() {
        searchTimeout?.cancel()
        searchTimeout = nil
        pendingConnection?.cancel()
        pendingConnection = nil
        browser?.cancel()
        browser = nil
        isSearching = false
    }

    private func resolveService(result: NWBrowser.Result) {
        // Cancel any pending connection
        pendingConnection?.cancel()

        let connection = NWConnection(to: result.endpoint, using: .tcp)
        pendingConnection = connection

        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard self?.pendingConnection === connection else { return }

                switch state {
                case .ready:
                    if let endpoint = connection.currentPath?.remoteEndpoint,
                       case .hostPort(let host, let port) = endpoint {
                        let hostString: String
                        switch host {
                        case .ipv4(let addr):
                            hostString = "\(addr)"
                        case .ipv6(let addr):
                            // Skip IPv6 link-local addresses, prefer IPv4
                            let addrString = "\(addr)"
                            if addrString.hasPrefix("fe80") {
                                print("Skipping IPv6 link-local address: \(addrString)")
                                connection.cancel()
                                return
                            }
                            hostString = "[\(addrString)]"
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

                        // Cache the URL
                        UserDefaults.standard.set(url.absoluteString, forKey: self?.cachedURLKey ?? "")

                        self?.stopSearching()
                    }
                    connection.cancel()
                case .waiting(let error):
                    print("Connection waiting: \(error)")
                case .failed(let error):
                    print("Connection failed: \(error)")
                    self?.pendingConnection = nil
                    connection.cancel()
                default:
                    break
                }
            }
        }

        connection.start(queue: .main)
    }

    public func setManualURL(_ urlString: String) {
        var urlToUse = urlString

        // Add http:// if no scheme provided
        if !urlToUse.contains("://") {
            urlToUse = "http://\(urlToUse)"
        }

        guard let url = URL(string: urlToUse) else {
            connectionStatus = .error("Invalid URL")
            return
        }
        serverURL = url
        connectionStatus = .connected(url.host ?? "unknown")
        UserDefaults.standard.set(url.absoluteString, forKey: cachedURLKey)
    }

    public func disconnect() {
        stopSearching()
        serverURL = nil
        connectionStatus = .disconnected
        UserDefaults.standard.removeObject(forKey: cachedURLKey)
    }
}

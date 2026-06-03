import SwiftUI
import Carbon
import Combine
import ClaudeHistoryShared

extension Notification.Name {
    static let popoverDidShow = Notification.Name("popoverDidShow")
    static let closePopover = Notification.Name("closePopover")
}

@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private var eventMonitor: Any?
    private var hotKeyRef: EventHotKeyRef?

    let serverDiscovery = ServerDiscovery()
    let apiClient = APIClient()
    let webSocketClient = WebSocketClient()
    lazy var viewModel = SessionListViewModel(apiClient: apiClient)

    private var cancellables = Set<AnyCancellable>()
    private var wsReconnectTask: Task<Void, Never>?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        setupPopover()
        registerGlobalHotKey()
        setupEventMonitor()

        // Listen for close popover requests
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleClosePopover),
            name: .closePopover,
            object: nil
        )

        // Load API key from keychain
        apiClient.loadAPIKeyFromKeychain()

        // Drive WebSocket setup off the discovered server URL. This is the single
        // place that calls configureWebSocket — so initial discovery, Bonjour late
        // discovery, and URL changes all keep the WS in sync with HTTP.
        serverDiscovery.$serverURL
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] url in
                guard let self, let url else { return }
                self.apiClient.setBaseURL(url)
                self.configureWebSocket(baseURL: url)
            }
            .store(in: &cancellables)

        // Recover from WS disconnects (e.g. server restart). HTTP self-heals via
        // ServerDiscovery, but the WS needs its own retry loop. The closure's
        // isolation is invisible to the compiler (onStateChange is a plain
        // `((WebSocketState) -> Void)?`), so hop to MainActor explicitly rather
        // than relying on WebSocketClient's internal @MainActor invariant.
        webSocketClient.onStateChange = { [weak self] state in
            guard state == .disconnected else { return }
            Task { @MainActor in self?.scheduleWebSocketReconnect() }
        }

        Task {
            await autoConnect()
        }
    }

    @objc private func handleClosePopover() {
        closePopover()
    }

    func applicationWillTerminate(_ notification: Notification) {
        unregisterGlobalHotKey()
        if let monitor = eventMonitor {
            NSEvent.removeMonitor(monitor)
        }
    }

    // MARK: - Status Item

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "message", accessibilityDescription: "Claude History")
            button.action = #selector(togglePopover)
            button.target = self
        }
    }

    // MARK: - Popover

    private func setupPopover() {
        popover = NSPopover()
        popover.contentSize = NSSize(width: 420, height: 500)
        popover.behavior = .transient
        popover.animates = true

        let contentView = SearchPopoverView()
            .environmentObject(serverDiscovery)
            .environmentObject(viewModel)
            .environment(\.apiClient, apiClient)
            .environment(\.webSocketClient, webSocketClient)

        popover.contentViewController = NSHostingController(rootView: contentView)
    }

    @objc func togglePopover() {
        if popover.isShown {
            closePopover()
        } else {
            showPopover()
        }
    }

    func showPopover() {
        if let button = statusItem.button {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
            // Notify view to refresh data
            NotificationCenter.default.post(name: .popoverDidShow, object: nil)
        }
    }

    func closePopover() {
        popover.performClose(nil)
    }

    // MARK: - Event Monitor (close on outside click)

    private func setupEventMonitor() {
        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            if self?.popover.isShown == true {
                self?.closePopover()
            }
        }
    }

    // MARK: - Global Hot Key (Cmd+Shift+C)

    private func registerGlobalHotKey() {
        var hotKeyID = EventHotKeyID()
        hotKeyID.signature = OSType(0x434C4155) // "CLAU"
        hotKeyID.id = 1

        // Cmd+Shift+C: keyCode 8 = 'C', modifiers: cmdKey + shiftKey
        let keyCode: UInt32 = 8
        let modifiers: UInt32 = UInt32(cmdKey | shiftKey)

        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))

        InstallEventHandler(GetApplicationEventTarget(), { (_, event, userData) -> OSStatus in
            guard let userData = userData else { return OSStatus(eventNotHandledErr) }
            let appDelegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()

            DispatchQueue.main.async {
                appDelegate.togglePopover()
            }

            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), nil)

        RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    private func unregisterGlobalHotKey() {
        if let hotKeyRef = hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
        }
    }

    // MARK: - Auto Connect

    private func autoConnect() async {
        // If discovery already has a URL, the $serverURL observer has handled it.
        if serverDiscovery.serverURL != nil {
            return
        }

        // Try localhost first — fast path when the user runs the server locally.
        let localhostURL = URL(string: "http://localhost:3847")!
        apiClient.setBaseURL(localhostURL)

        do {
            if try await apiClient.checkHealth() {
                serverDiscovery.setManualURL("http://localhost:3847")
                return
            }
        } catch {
            // Localhost unreachable — fall through to Bonjour.
        }

        // Bonjour will publish to serverDiscovery.serverURL when it finds the server;
        // the $serverURL observer will configure the WS at that point.
        serverDiscovery.startSearching()
    }

    private func configureWebSocket(baseURL: URL) {
        wsReconnectTask?.cancel()
        webSocketClient.configure(baseURL: baseURL, apiKey: apiClient.getAPIKey())

        Task { @MainActor in
            do {
                try await webSocketClient.connect()
                print("[WebSocket] Connected successfully")
            } catch {
                print("[WebSocket] Connection failed: \(error)")
                // Don't rely on WebSocketClient.connect() transitioning state on
                // every throw path (e.g. invalid-URL throws skip .disconnected).
                // Schedule the retry here so it's guaranteed.
                scheduleWebSocketReconnect()
            }
        }
    }

    /// Debounced retry: each new .disconnected callback resets the 2s timer, so
    /// rapid connect-fail loops collapse into a single delayed attempt. The
    /// guard is `!= .authenticated` (not `== .disconnected`) so we still
    /// recover if the WS got stuck at `.connecting` (e.g. connect Task was
    /// cancelled mid-handshake and state never rolled back).
    private func scheduleWebSocketReconnect() {
        wsReconnectTask?.cancel()
        wsReconnectTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let self, !Task.isCancelled else { return }
            guard self.webSocketClient.state != .authenticated,
                  let url = self.serverDiscovery.serverURL else { return }
            self.configureWebSocket(baseURL: url)
        }
    }
}

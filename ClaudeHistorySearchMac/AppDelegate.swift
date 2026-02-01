import SwiftUI
import Carbon
import ClaudeHistoryShared

extension Notification.Name {
    static let popoverDidShow = Notification.Name("popoverDidShow")
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

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        setupPopover()
        registerGlobalHotKey()
        setupEventMonitor()

        // Load API key from keychain
        apiClient.loadAPIKeyFromKeychain()

        Task {
            await autoConnect()
        }
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
            .environmentObject(apiClient)
            .environmentObject(webSocketClient)

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
        if let existingURL = serverDiscovery.serverURL {
            apiClient.setBaseURL(existingURL)
            configureWebSocket(baseURL: existingURL)
            return
        }

        let localhostURL = URL(string: "http://localhost:3847")!
        apiClient.setBaseURL(localhostURL)

        do {
            let healthy = try await apiClient.checkHealth()
            if healthy {
                serverDiscovery.setManualURL("http://localhost:3847")
                configureWebSocket(baseURL: localhostURL)
                return
            }
        } catch {
            // Localhost failed, try Bonjour
        }

        serverDiscovery.startSearching()
        try? await Task.sleep(nanoseconds: 3_000_000_000)

        if let url = serverDiscovery.serverURL {
            apiClient.setBaseURL(url)
            configureWebSocket(baseURL: url)
        }
    }

    private func configureWebSocket(baseURL: URL) {
        webSocketClient.configure(baseURL: baseURL, apiKey: apiClient.getAPIKey())

        // Auto-connect WebSocket
        Task {
            do {
                try await webSocketClient.connect()
                print("[WebSocket] Connected successfully")
            } catch {
                print("[WebSocket] Connection failed: \(error)")
            }
        }
    }
}

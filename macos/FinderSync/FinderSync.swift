import Cocoa
import FinderSync

/// Finder Sync extension for Font Buttler.
///
/// This process never copies, activates, or installs a font. A click sends
/// `{action, paths, requestId}` to the launchd-vended Mach service for this
/// build's app group. The listener is the signed helper in the containing
/// app, not the Electron process. If that service is down, this shows an
/// error and leaves Services as the way to install. The helper launches the
/// app when the service is up and the app is not.
/// There is no URL scheme and no Apple event: any page could open a URL,
/// and an open-document event is delivered as coming from Launch Services.
///
/// Home, `/Users/Shared`, and `/Volumes` are monitored. `/Library/Fonts` is
/// not: installing from a system font folder is not a use case. Dropbox and
/// iCloud Drive are File Provider domains, and a Finder Sync menu often does
/// not appear there. Services remain the way to install from those folders.
private let fontExtensions: Set<String> = ["otf", "ttf", "ttc", "otc", "woff", "woff2"]

@objc protocol FontButtlerFinderSyncHandoff {
    func statusWithReply(_ reply: @escaping (String?) -> Void)
    func submitAction(_ action: String, paths: [String], requestId: String, reply: @escaping (String?) -> Void)
}

private let finderSyncMissingApp = "Font Buttler couldn't be found. Open it once from its new location."
private let finderSyncAgentDisabled = "Turn on Font Buttler in Login Items. Until then, use Services (right-click > Services > Install)."

@objc(FontButtlerFinderSync)
final class FontButtlerFinderSync: FIFinderSync {
    private let handoffQueue = DispatchQueue(label: "app.fontbutler.desktop.FinderSync.handoff")

    override init() {
        super.init()
        let home = FileManager.default.homeDirectoryForCurrentUser
        let shared = URL(fileURLWithPath: "/Users/Shared", isDirectory: true)
        let volumes = URL(fileURLWithPath: "/Volumes", isDirectory: true)
        FIFinderSyncController.default().directoryURLs = [home, shared, volumes]
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        if #available(macOS 13.0, *) {
        } else {
            return nil
        }
        guard menuKind == .contextualMenuForItems else { return nil }
        let selected = FIFinderSyncController.default().selectedItemURLs() ?? []
        guard !selected.isEmpty, selected.allSatisfy(isInstallSelection) else { return nil }

        let menu = NSMenu(title: "")
        menu.addItem(
            menuItem(
                title: menuTitle(key: "FontButtlerInstallTitle", fallback: "Install"),
                action: #selector(installSelection(_:))
            )
        )
        menu.addItem(
            menuItem(
                title: menuTitle(key: "FontButtlerInstallAsTitle", fallback: "Install as…"),
                action: #selector(installSelectionAs(_:))
            )
        )
        return menu
    }

    private func menuItem(title: String, action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func installSelection(_ sender: Any?) {
        handOff(action: "install")
    }

    @objc private func installSelectionAs(_ sender: Any?) {
        handOff(action: "installAs")
    }

    /// Send the selection to the containing app. One request id per click.
    /// A missing service shows an error. This process does not fall back to a URL.
    private func handOff(action: String) {
        let selected = FIFinderSyncController.default().selectedItemURLs() ?? []
        let paths = selected.filter { isInstallSelection($0) && $0.isFileURL }.map(\.path)
        guard !paths.isEmpty, parentAppURL() != nil else {
            showFinderSyncError(finderSyncMissingApp)
            return
        }
        let service = menuTitle(key: "FontButtlerMachService", fallback: "")
        guard !service.isEmpty else {
            showFinderSyncError(finderSyncAgentDisabled)
            return
        }
        let requestId = UUID().uuidString
        handoffQueue.async {
            deliverFinderSyncHandoff(service: service, action: action, paths: paths, requestId: requestId)
        }
    }
}

/// Log only. A notification from this extension would be a separate app
/// permission. The helper sends the message to Font Buttler, which already
/// has notification permission, or records it for the next launch.
private func showFinderSyncError(_ message: String) {
    NSLog("Finder Sync: %@", message)
}

private func isFontFile(_ url: URL) -> Bool {
    fontExtensions.contains(url.pathExtension.lowercased())
}

/// Font files, and folders. The app imports a folder the same way Services does.
private func isInstallSelection(_ url: URL) -> Bool {
    if isFontFile(url) { return true }
    if url.hasDirectoryPath { return true }
    let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    if values?.isSymbolicLink == true { return false }
    return values?.isDirectory == true
}

private func menuTitle(key: String, fallback: String) -> String {
    let value = Bundle.main.object(forInfoDictionaryKey: key) as? String
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? fallback : trimmed
}

/// The `.app` that contains this `.appex`, from the bundle URL of this process.
/// This is not a hardcoded `/Applications` path, so a moved app targets itself.
func parentAppURL(bundleURL: URL = Bundle.main.bundleURL) -> URL? {
    var url = bundleURL
    for _ in 0..<8 {
        if url.pathExtension == "app" { return url }
        let parent = url.deletingLastPathComponent()
        if parent.path == url.path { return nil }
        url = parent
    }
    return nil
}

private final class HandoffAttempt {
    private let lock = NSLock()
    private var finished = false
    private(set) var accepted = false
    private(set) var message = ""
    let semaphore = DispatchSemaphore(value: 0)

    func succeed() {
        lock.lock()
        let first = !finished
        finished = true
        accepted = true
        lock.unlock()
        if first { semaphore.signal() }
    }

    func fail(_ text: String = "") {
        lock.lock()
        let first = !finished
        finished = true
        if !text.isEmpty { message = text }
        lock.unlock()
        if first { semaphore.signal() }
    }
}

private func connectFinderSync(service: String, timeout: TimeInterval, body: (FontButtlerFinderSyncHandoff, HandoffAttempt) -> Void) -> HandoffAttempt {
    let connection = NSXPCConnection(machServiceName: service, options: [])
    connection.remoteObjectInterface = NSXPCInterface(with: FontButtlerFinderSyncHandoff.self)
    let attempt = HandoffAttempt()
    connection.interruptionHandler = { attempt.fail() }
    connection.invalidationHandler = { attempt.fail() }
    connection.resume()
    let remote = connection.remoteObjectProxyWithErrorHandler { _ in
        attempt.fail()
    } as! FontButtlerFinderSyncHandoff
    body(remote, attempt)
    let slice = timeout > 0 ? timeout : 0.05
    _ = attempt.semaphore.wait(timeout: .now() + slice)
    connection.invalidate()
    return attempt
}

/// The helper answers status as soon as launchd has started it. A miss means
/// the login item is not enabled, so the click does not wait out a 10s retry.
private func finderSyncAgentIsReachable(service: String) -> Bool {
    let deadline = Date().addingTimeInterval(1.5)
    while Date() < deadline {
        let remaining = deadline.timeIntervalSinceNow
        if remaining <= 0 { return false }
        let attempt = connectFinderSync(service: service, timeout: min(0.4, remaining)) { remote, attempt in
            remote.statusWithReply { error in
                if error == nil {
                    attempt.succeed()
                } else {
                    attempt.fail(error ?? "")
                }
            }
        }
        if attempt.accepted { return true }
        Thread.sleep(forTimeInterval: 0.05)
    }
    return false
}

private func sendFinderSyncHandoff(service: String, action: String, paths: [String], requestId: String, timeout: TimeInterval) -> HandoffAttempt {
    connectFinderSync(service: service, timeout: timeout) { remote, attempt in
        remote.submitAction(action, paths: paths, requestId: requestId) { error in
            if error == nil {
                attempt.succeed()
            } else {
                attempt.fail(error ?? "")
            }
        }
    }
}

/// One request id for the click. If the helper is not running, say so
/// immediately. If it is, one submit covers the helper's launch window.
func deliverFinderSyncHandoff(service: String, action: String, paths: [String], requestId: String) {
    if !finderSyncAgentIsReachable(service: service) {
        showFinderSyncError(finderSyncAgentDisabled)
        return
    }
    let attempt = sendFinderSyncHandoff(service: service, action: action, paths: paths, requestId: requestId, timeout: 9)
    if attempt.accepted { return }
    if attempt.message.isEmpty {
        showFinderSyncError(finderSyncAgentDisabled)
        return
    }
        showFinderSyncError(attempt.message)
}

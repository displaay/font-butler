import Cocoa
import FinderSync

/// Finder Sync extension for Font Buttler.
///
/// This process never copies, activates, or installs a font. A click sends
/// `{action, paths}` to the containing app over that build's app-group Mach
/// service. If the app is not running, this launches it with
/// `openApplication` and no file URLs, then retries the connection.
/// There is no URL scheme and no Apple event: any page could open a URL,
/// and an open-document event is delivered as coming from Launch Services.
///
/// Home and `/Volumes` are monitored. Dropbox and iCloud Drive are File
/// Provider domains, and a Finder Sync menu often does not appear there.
/// Services remain the way to install from those folders.
private let fontExtensions: Set<String> = ["otf", "ttf", "ttc", "otc", "woff", "woff2"]

@objc protocol FontButtlerFinderSyncHandoff {
    func submitAction(_ action: String, paths: [String], reply: @escaping (String?) -> Void)
}

@objc(FontButtlerFinderSync)
final class FontButtlerFinderSync: FIFinderSync {
    private let handoffQueue = DispatchQueue(label: "app.fontbutler.desktop.FinderSync.handoff")

    override init() {
        super.init()
        let home = FileManager.default.homeDirectoryForCurrentUser
        let volumes = URL(fileURLWithPath: "/Volumes", isDirectory: true)
        FIFinderSyncController.default().directoryURLs = [home, volumes]
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
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

    /// Send the selection to the containing app. A missing service name or
    /// bundle does nothing. This process does not fall back to a URL.
    private func handOff(action: String) {
        let selected = FIFinderSyncController.default().selectedItemURLs() ?? []
        let paths = selected.filter { isInstallSelection($0) && $0.isFileURL }.map(\.path)
        guard !paths.isEmpty, let appURL = parentAppURL() else { return }
        let service = menuTitle(key: "FontButtlerMachService", fallback: "")
        guard !service.isEmpty else { return }
        handoffQueue.async {
            deliverFinderSyncHandoff(service: service, appURL: appURL, action: action, paths: paths)
        }
    }
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
    let semaphore = DispatchSemaphore(value: 0)

    func succeed() {
        lock.lock()
        let first = !finished
        finished = true
        accepted = true
        lock.unlock()
        if first { semaphore.signal() }
    }

    func fail() {
        lock.lock()
        let first = !finished
        finished = true
        lock.unlock()
        if first { semaphore.signal() }
    }
}

private func sendFinderSyncHandoff(service: String, action: String, paths: [String], timeout: TimeInterval) -> Bool {
    let connection = NSXPCConnection(machServiceName: service, options: [])
    connection.remoteObjectInterface = NSXPCInterface(with: FontButtlerFinderSyncHandoff.self)
    let attempt = HandoffAttempt()
    connection.interruptionHandler = { attempt.fail() }
    connection.invalidationHandler = { attempt.fail() }
    connection.resume()
    let remote = connection.remoteObjectProxyWithErrorHandler { _ in
        attempt.fail()
    } as! FontButtlerFinderSyncHandoff
    remote.submitAction(action, paths: paths) { _ in
        attempt.succeed()
    }
    let slice = timeout > 0 ? timeout : 0.05
    _ = attempt.semaphore.wait(timeout: .now() + slice)
    connection.invalidate()
    return attempt.accepted
}

/// Launch the containing app with no file URLs and no Apple event, then retry
/// the Mach service until the handoff is accepted or about 10 seconds pass.
func deliverFinderSyncHandoff(service: String, appURL: URL, action: String, paths: [String]) {
    let deadline = Date().addingTimeInterval(10)
    var delay: TimeInterval = 0.05
    var launched = false
    while Date() < deadline {
        let remaining = deadline.timeIntervalSinceNow
        if remaining <= 0 { return }
        if sendFinderSyncHandoff(service: service, action: action, paths: paths, timeout: min(1.0, remaining)) {
            return
        }
        if !launched {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { _, _ in }
            launched = true
        }
        let slice = min(delay, min(1.0, max(0, deadline.timeIntervalSinceNow)))
        if slice <= 0 { return }
        Thread.sleep(forTimeInterval: slice)
        delay = min(delay * 2, 1)
    }
}

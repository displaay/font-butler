import Cocoa
import Darwin
import FinderSync
import os

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
/// Home, `/Users/Shared`, `/Volumes`, and each mounted volume are monitored.
/// `/Volumes` alone does not show a menu on a disk image, hidden or visible,
/// so each mount from `NSWorkspace` is registered and updated on didMount
/// and didUnmount. `/` and `/Library/Fonts` are not. Dropbox and iCloud
/// Drive are File Provider domains, and a Finder Sync menu often does not
/// appear there. Services remain the way to install from those folders.
/// File-level lets are initialised on first use. The appex is compiled with
/// `-parse-as-library`; script mode would leave them uninitialised because
/// this process starts at `_NSExtensionMain`, and the contextual menu's
/// first `Set.contains` would crash.
private let fontExtensions: Set<String> = ["otf", "ttf", "ttc", "otc", "woff", "woff2"]

@objc protocol FontButtlerFinderSyncHandoff {
    func statusWithReply(_ reply: @escaping (String?) -> Void)
    func submitAction(_ action: String, paths: [String], requestId: String, reply: @escaping (String?) -> Void)
}

private let finderSyncMissingApp = "Font Buttler couldn't be found. Open it once from its new location."
private let finderSyncAgentDisabled = "Turn on Font Buttler in Login Items. Until then, use Services (right-click > Services > Install)."

/// In this sandboxed appex, FileManager's current-user home is the container
/// (`~/Library/Containers/<appex-id>/Data`), so Desktop, Documents, and
/// Downloads would sit outside the menu. `pw_dir` is the real home.
/// A container path is ignored. Shared, /Volumes, and mount paths stay absolute.
private func finderSyncHomeDirectory() -> URL? {
    guard let entry = getpwuid(getuid()), let dir = entry.pointee.pw_dir else { return nil }
    let path = String(cString: dir)
    if path.isEmpty || path.contains("/Library/Containers/") { return nil }
    return URL(fileURLWithPath: path, isDirectory: true)
}

/// Every mounted volume except `/` and `/Library/Fonts`. The enumeration
/// options are empty so a hidden disk image stays in the set.
private func finderSyncMountedVolumeURLs() -> [URL] {
    NSWorkspace.shared.mountedVolumeURLs(includingResourceValuesForKeys: nil, options: []) ?? []
}

private func finderSyncDirectoryURLs() -> Set<URL> {
    var monitored = [
        URL(fileURLWithPath: "/Users/Shared", isDirectory: true),
        URL(fileURLWithPath: "/Volumes", isDirectory: true),
    ]
    if let home = finderSyncHomeDirectory() {
        monitored.insert(home, at: 0)
    }
    for url in finderSyncMountedVolumeURLs() {
        let path = url.standardizedFileURL.path
        if path == "/" || path == "/Library/Fonts" || path.hasPrefix("/Library/Fonts/") { continue }
        monitored.append(url)
    }
    return Set(monitored)
}

@objc(FontButtlerFinderSync)
final class FontButtlerFinderSync: FIFinderSync {
    private let handoffQueue = DispatchQueue(label: "app.fontbutler.desktop.FinderSync.handoff")
    private var volumeObservers: [NSObjectProtocol] = []

    override init() {
        super.init()
        refreshFinderSyncDirectories()
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didMountNotification, NSWorkspace.didUnmountNotification] {
            let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.refreshFinderSyncDirectories()
            }
            volumeObservers.append(token)
        }
    }

    deinit {
        let center = NSWorkspace.shared.notificationCenter
        for token in volumeObservers {
            center.removeObserver(token)
        }
    }

    private func refreshFinderSyncDirectories() {
        FIFinderSyncController.default().directoryURLs = finderSyncDirectoryURLs()
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
        menu.addItem(
            menuItem(
                title: menuTitle(key: "FontButtlerCompareTitle", fallback: "Compare"),
                action: #selector(compareSelection(_:))
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

    /// Opens the files in Cuttler's Compare window. The extension still only
    /// hands the paths across; it does not read the fonts.
    @objc private func compareSelection(_ sender: Any?) {
        handOff(action: "compare")
    }

    /// Send the selection to the containing app. One request id per click.
    /// A missing service shows an error. This process does not fall back to a URL.
    private func handOff(action: String) {
        let selected = FIFinderSyncController.default().selectedItemURLs() ?? []
        let paths = selected.filter { isInstallSelection($0) && $0.isFileURL }.map(\.path)
        guard !paths.isEmpty, parentAppURL() != nil else {
            showFinderSyncError(finderSyncMissingApp, code: "missing-app")
            return
        }
        let service = menuTitle(key: "FontButtlerMachService", fallback: "")
        guard !service.isEmpty else {
            showFinderSyncError(finderSyncAgentDisabled, code: "login-items")
            return
        }
        let requestId = UUID().uuidString
        handoffQueue.async {
            deliverFinderSyncHandoff(service: service, action: action, paths: paths, requestId: requestId)
        }
    }
}

/// The message is a fixed string, and `detail` is an error domain and code.
/// `%{public}` keeps both visible in Console. A dynamic string is private
/// by default, which hid the failed Install. `code` is also written to the
/// app-group pending-error file, because a denied Mach lookup never starts
/// the helper that would have written the Application Support copy.
private func showFinderSyncError(_ message: String, code: String = "", detail: String = "") {
    if detail.isEmpty {
        os_log("Finder Sync: %{public}@", type: .error, message)
    } else {
        os_log("Finder Sync: %{public}@ (%{public}@)", type: .error, message, detail)
    }
    if !code.isEmpty {
        queueFinderSyncPendingError(code)
    }
}

private func queueFinderSyncPendingError(_ code: String) {
    let allowed = ["missing-app", "not-running", "login-items", "unknown-action"]
    guard allowed.contains(code) else { return }
    let group = menuTitle(key: "FontButtlerAppGroup", fallback: "")
    guard !group.isEmpty,
          let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return }
    let filePath = directory.appendingPathComponent("finder-sync-pending-error.json").path
    var entries: [[String: Any]] = []
    let existing = filePath.withCString { open($0, O_RDONLY | O_NOFOLLOW) }
    if existing >= 0 {
        var info = stat()
        if fstat(existing, &info) == 0, info.st_size > 0, info.st_size <= 8192, (Int32(info.st_mode) & S_IFMT) == S_IFREG {
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(info.st_size))
            defer { buffer.deallocate() }
            let got = read(existing, buffer, Int(info.st_size))
            if got > 0,
               let parsed = try? JSONSerialization.jsonObject(with: Data(bytes: buffer, count: got)) as? [String: Any],
               let list = parsed["errors"] as? [[String: Any]] {
                entries = list
            }
        }
        close(existing)
    } else if errno != ENOENT {
        return
    }
    if entries.contains(where: { ($0["code"] as? String) == code }) { return }
    if entries.count >= 5 { entries.removeFirst() }
    entries.append(["code": code, "at": Int64(Date().timeIntervalSince1970 * 1000)])
    guard let data = try? JSONSerialization.data(withJSONObject: ["errors": entries]) else { return }
    let tempPath = filePath + ".tmp"
    _ = tempPath.withCString { unlink($0) }
    let output = tempPath.withCString { open($0, O_CREAT | O_EXCL | O_NOFOLLOW | O_WRONLY, 0o600) }
    if output < 0 { return }
    let wrote = data.withUnsafeBytes { raw -> Bool in
        guard let base = raw.baseAddress else { return false }
        var sent = 0
        while sent < raw.count {
            let count = write(output, base.advanced(by: sent), raw.count - sent)
            if count < 0 && errno == EINTR { continue }
            if count <= 0 { return false }
            sent += count
        }
        return fsync(output) == 0
    }
    close(output)
    let renamed = filePath.withCString { destination in
        tempPath.withCString { source in
            rename(source, destination) == 0
        }
    }
    if !wrote || !renamed {
        _ = tempPath.withCString { unlink($0) }
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

/// Packed names that contain this appex. The zip keeps Font Buttler.app.
private let finderSyncProductAppNames: Set<String> = ["Cuttler.app", "Font Buttler.app", "Font Buttler Test.app"]

/// The `.app` that contains this `.appex`, from the bundle URL of this process.
/// This is not a hardcoded `/Applications` path, so a moved app targets itself.
/// Cuttler.app and the zip's Font Buttler.app are both the containing app.
func parentAppURL(bundleURL: URL = Bundle.main.bundleURL) -> URL? {
    var url = bundleURL
    var fallback: URL?
    for _ in 0..<12 {
        if url.pathExtension == "app", url.lastPathComponent != "FontButtlerFinderSyncAgent.app" {
            if finderSyncProductAppNames.contains(url.lastPathComponent) { return url }
            if fallback == nil { fallback = url }
        }
        let parent = url.deletingLastPathComponent()
        if parent.path == url.path { break }
        url = parent
    }
    return fallback
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

    func fail(_ text: String = "", detail: String = "") {
        lock.lock()
        let first = !finished
        finished = true
        if !text.isEmpty { message = text }
        if !detail.isEmpty { self.detail = detail }
        lock.unlock()
        if first { semaphore.signal() }
    }

    private(set) var detail = ""
}

private func connectFinderSync(service: String, timeout: TimeInterval, body: (FontButtlerFinderSyncHandoff, HandoffAttempt) -> Void) -> HandoffAttempt {
    let connection = NSXPCConnection(machServiceName: service, options: [])
    connection.remoteObjectInterface = NSXPCInterface(with: FontButtlerFinderSyncHandoff.self)
    let attempt = HandoffAttempt()
    connection.interruptionHandler = { attempt.fail() }
    connection.invalidationHandler = { attempt.fail() }
    connection.resume()
    let remote = connection.remoteObjectProxyWithErrorHandler { error in
        let nsError = error as NSError
        attempt.fail(detail: "\(nsError.domain) \(nsError.code)")
    } as! FontButtlerFinderSyncHandoff
    body(remote, attempt)
    let slice = timeout > 0 ? timeout : 0.05
    _ = attempt.semaphore.wait(timeout: .now() + slice)
    connection.invalidate()
    return attempt
}

/// The helper answers status as soon as launchd has started it. A miss means
/// the login item is not enabled, so the click does not wait out a 10s retry.
private func probeFinderSyncAgent(service: String) -> HandoffAttempt {
    var last = HandoffAttempt()
    let deadline = Date().addingTimeInterval(1.5)
    while Date() < deadline {
        let remaining = deadline.timeIntervalSinceNow
        if remaining <= 0 { return last }
        let attempt = connectFinderSync(service: service, timeout: min(0.4, remaining)) { remote, attempt in
            remote.statusWithReply { error in
                if error == nil {
                    attempt.succeed()
                } else {
                    attempt.fail(error ?? "")
                }
            }
        }
        last = attempt
        if attempt.accepted { return attempt }
        Thread.sleep(forTimeInterval: 0.05)
    }
    return last
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
    let probe = probeFinderSyncAgent(service: service)
    if !probe.accepted {
        showFinderSyncError(finderSyncAgentDisabled, code: "login-items", detail: probe.detail)
        return
    }
    // The helper's whole forward wait is kForwardAfterSpawnSeconds (20).
    let attempt = sendFinderSyncHandoff(service: service, action: action, paths: paths, requestId: requestId, timeout: 35)
    if attempt.accepted { return }
    if attempt.message.isEmpty {
        showFinderSyncError(finderSyncAgentDisabled, code: "login-items", detail: attempt.detail)
        return
    }
    showFinderSyncError(attempt.message, detail: attempt.detail)
}

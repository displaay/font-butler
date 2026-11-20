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
/// `/Volumes` alone does not show a menu on a disk image, hidden or visible.
/// Mounts come from `FileManager` and are updated on didMount and didUnmount.
/// `/`, `/Library/Fonts`, and `/System/Volumes` are not. Dropbox and iCloud
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
    func reportPendingErrors(_ codes: [String], reply: @escaping (String?) -> Void)
}

private let finderSyncMissingApp = "Cuttler couldn't be found. Open it once from its new location."
private let finderSyncAgentDisabled = "Turn on Cuttler in Login Items. Until then, use Services (right-click > Services > Install)."

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

/// `FileManager.mountedVolumeURLs` is the API. `NSWorkspace` has no such
/// method. Empty options keep a hidden disk image. `/System/Volumes`
/// (Data, Preboot, VM) is not a user mount.
private func finderSyncMountedVolumeURLs() -> [URL] {
    let keys: [URLResourceKey] = []
    return FileManager.default.mountedVolumeURLs(includingResourceValuesForKeys: keys, options: []) ?? []
}

/// Same exclusions as `finderSyncMountPathIncluded` in electron/finder-sync.mjs.
private func finderSyncMountPathIncluded(_ path: String) -> Bool {
    if path == "/" || path == "/Library/Fonts" || path.hasPrefix("/Library/Fonts/") { return false }
    if path == "/System/Volumes" || path.hasPrefix("/System/Volumes/") { return false }
    return true
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
        var path = url.standardizedFileURL.path
        if path.count > 1 && path.hasSuffix("/") {
            path = String(path.dropLast())
        }
        if !finderSyncMountPathIncluded(path) { continue }
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
        let service = menuTitle(key: "FontButtlerMachService", fallback: "")
        if !service.isEmpty {
            handoffQueue.async {
                flushPendingFinderSyncErrors(service: service)
            }
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

private let finderSyncPendingErrorAllowedCodes = ["missing-app", "not-running", "login-items", "unknown-action"]

private func pendingErrorGroupFilePath() -> String? {
    let group = menuTitle(key: "FontButtlerAppGroup", fallback: "")
    guard !group.isEmpty,
          let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return directory.appendingPathComponent("finder-sync-pending-error.json").path
}

private func readFinderSyncPendingErrorEntries(filePath: String) -> (entries: [[String: Any]], readable: Bool) {
    var entries: [[String: Any]] = []
    let existing = filePath.withCString { open($0, O_RDONLY | O_NOFOLLOW) }
    if existing >= 0 {
        var info = stat()
        if fstat(existing, &info) == 0, info.st_size > 0, info.st_size <= 8192, (info.st_mode & S_IFMT) == S_IFREG {
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
        return (entries, true)
    }
    if errno == ENOENT {
        return ([], true)
    }
    return ([], false)
}

private func queueFinderSyncPendingError(_ code: String) {
    guard finderSyncPendingErrorAllowedCodes.contains(code),
          let filePath = pendingErrorGroupFilePath()
    else { return }
    let readResult = readFinderSyncPendingErrorEntries(filePath: filePath)
    guard readResult.readable else { return }
    var entries = readResult.entries
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

/// Drain any queued app-group error codes over XPC to the helper so the main
/// Electron app never opens the sandboxed group container directly.
private func flushPendingFinderSyncErrors(service: String) {
    guard !service.isEmpty, let filePath = pendingErrorGroupFilePath() else { return }
    let readResult = readFinderSyncPendingErrorEntries(filePath: filePath)
    guard readResult.readable else { return }
    var codes: [String] = []
    for item in readResult.entries {
        guard let code = item["code"] as? String,
              finderSyncPendingErrorAllowedCodes.contains(code),
              !codes.contains(code)
        else { continue }
        codes.append(code)
        if codes.count >= 5 { break }
    }
    guard !codes.isEmpty else { return }
    let attempt = connectFinderSync(service: service, timeout: 0.4) { remote, attempt in
        remote.reportPendingErrors(codes) { error in
            if error == nil {
                attempt.succeed()
            } else {
                attempt.fail(error ?? "")
            }
        }
    }
    if attempt.accepted {
        _ = filePath.withCString { unlink($0) }
    }
}

private let bundlePackageExtensions: Set<String> = [
    "app", "appex", "bundle", "framework", "kext", "mdimporter", "mpkg",
    "pkg", "plugin", "prefpane", "qlgenerator", "saver", "xpc",
]

private func isFontFile(_ url: URL) -> Bool {
    fontExtensions.contains(url.pathExtension.lowercased())
}

/// Font files, and folders. Bundles and packages (such as `.app` or `.pkg`) are excluded.
private func isInstallSelection(_ url: URL) -> Bool {
    let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isPackageKey, .isSymbolicLinkKey])
    if values?.isSymbolicLink == true { return false }
    if values?.isPackage == true { return false }
    if bundlePackageExtensions.contains(url.pathExtension.lowercased()) { return false }
    if isFontFile(url) { return true }
    if let isDirectory = values?.isDirectory { return isDirectory }
    return url.hasDirectoryPath
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
    flushPendingFinderSyncErrors(service: service)
    // The helper's whole forward wait is kForwardAfterSpawnSeconds (20).
    let attempt = sendFinderSyncHandoff(service: service, action: action, paths: paths, requestId: requestId, timeout: 35)
    if attempt.accepted { return }
    if attempt.message.isEmpty {
        showFinderSyncError(finderSyncAgentDisabled, code: "login-items", detail: attempt.detail)
        return
    }
    showFinderSyncError(attempt.message, detail: attempt.detail)
}

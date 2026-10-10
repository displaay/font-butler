import Cocoa
import FinderSync

/// Finder Sync extension for Font Buttler.
///
/// This process never copies, activates, or installs a font. It only asks the
/// containing app to open a font-butler URL that lists the files and folders
/// the user selected. A test build uses font-butler-test and its own menu
/// titles, and opens the .app that contains this appex, so it cannot hand
/// the selection to the release app.
///
/// `/` is monitored, and so are the home directory plus the File Provider
/// roots Finder does not always treat as descendants of `/`:
/// `~/Library/CloudStorage` (and each child, such as Dropbox), `~/Library/Mobile Documents`,
/// and `~/Library/Mobile Documents/com~apple~CloudDocs` (iCloud Drive).
/// Whether Dropbox's own Finder Sync extension still hides this menu inside
/// its folder can only be confirmed in Finder on a Mac.
private let fontExtensions: Set<String> = ["otf", "ttf", "ttc", "otc", "woff", "woff2"]

@objc(FontButtlerFinderSync)
final class FontButtlerFinderSync: FIFinderSync {
    override init() {
        super.init()
        let home = FileManager.default.homeDirectoryForCurrentUser
        FIFinderSyncController.default().directoryURLs = finderSyncDirectoryURLs(home: home)
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
        handOff(action: "install-as")
    }

    /// Pass the current Finder selection to the containing app.
    /// `withApplicationAt` launches that app when it is not running.
    /// A missing or moved bundle must not crash this process, and the
    /// fallback uses this build's URL scheme only.
    private func handOff(action: String) {
        let selected = FIFinderSyncController.default().selectedItemURLs() ?? []
        let paths = selected.filter(isInstallSelection).map(\.path)
        guard !paths.isEmpty else { return }
        let scheme = (Bundle.main.object(forInfoDictionaryKey: "FontButtlerURLScheme") as? String) ?? "font-butler"
        guard let url = finderSyncURL(scheme: scheme, action: action, paths: paths) else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        let openByScheme = {
            NSWorkspace.shared.open(url, configuration: configuration) { _, _ in }
        }
        guard let appURL = parentAppURL() else {
            openByScheme()
            return
        }
        NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: configuration) { _, error in
            if error != nil {
                openByScheme()
            }
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

/// `font-butler://finder/install?p=/absolute/file.otf`
/// A test build uses `font-butler-test` so Launch Services will not open the release app.
func finderSyncURL(scheme: String, action: String, paths: [String]) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = "finder"
    components.path = "/" + action
    components.queryItems = paths.map { URLQueryItem(name: "p", value: $0) }
    return components.url
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

/// `/`, the home directory, CloudStorage and its children, Mobile Documents, and iCloud Drive.
/// Paths that are not there are skipped. Listing CloudStorage must not crash the extension.
func finderSyncDirectoryURLs(home: URL, fileManager: FileManager = .default) -> Set<URL> {
    let cloud = home.appendingPathComponent("Library/CloudStorage", isDirectory: true)
    let mobile = home.appendingPathComponent("Library/Mobile Documents", isDirectory: true)
    let icloud = mobile.appendingPathComponent("com~apple~CloudDocs", isDirectory: true)
    var candidates = [
        URL(fileURLWithPath: "/", isDirectory: true),
        home,
        cloud,
        mobile,
        icloud,
    ]
    if let children = try? fileManager.contentsOfDirectory(
        at: cloud,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
    ) {
        candidates.append(contentsOf: children)
    }
    var urls = Set<URL>()
    for url in candidates {
        if url.path == "/" || fileManager.fileExists(atPath: url.path) {
            urls.insert(url)
        }
    }
    return urls
}

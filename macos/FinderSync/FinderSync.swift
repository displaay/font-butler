import Cocoa
import FinderSync

/// Finder Sync extension for Font Buttler.
///
/// This process never copies, activates, or installs a font. It only asks the
/// parent app to open a font-butler URL that lists the files the user selected.
private let fontExtensions: Set<String> = ["otf", "ttf", "ttc", "otc", "woff", "woff2"]

@objc(FontButtlerFinderSync)
final class FontButtlerFinderSync: FIFinderSync {
    override init() {
        super.init()
        let root = URL(fileURLWithPath: "/", isDirectory: true)
        FIFinderSyncController.default().directoryURLs = [root]
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        guard menuKind == .contextualMenuForItems else { return nil }
        let selected = FIFinderSyncController.default().selectedItemURLs() ?? []
        guard !selected.isEmpty, selected.allSatisfy(isFontFile) else { return nil }

        let menu = NSMenu(title: "")
        menu.addItem(menuItem(title: "Install", action: #selector(installSelection(_:))))
        menu.addItem(menuItem(title: "Install as…", action: #selector(installSelectionAs(_:))))
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

    /// Pass only the current Finder selection to the parent app.
    private func handOff(action: String) {
        let selected = FIFinderSyncController.default().selectedItemURLs() ?? []
        let paths = selected.filter(isFontFile).map(\.path)
        guard !paths.isEmpty, let url = finderSyncURL(action: action, paths: paths) else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        if let appURL = parentAppURL() {
            NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: configuration) { _, _ in }
            return
        }
        NSWorkspace.shared.open(url)
    }
}

private func isFontFile(_ url: URL) -> Bool {
    fontExtensions.contains(url.pathExtension.lowercased())
}

/// `font-butler://finder/install?p=/absolute/file.otf`
func finderSyncURL(action: String, paths: [String]) -> URL? {
    var components = URLComponents()
    components.scheme = "font-butler"
    components.host = "finder"
    components.path = "/" + action
    components.queryItems = paths.map { URLQueryItem(name: "p", value: $0) }
    return components.url
}

/// `Font Buttler.app` that contains this `.appex`.
private func parentAppURL() -> URL? {
    let appURL = Bundle.main.bundleURL
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    guard appURL.pathExtension == "app" else { return nil }
    return appURL
}

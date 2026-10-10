import Cocoa
import CoreServices
import FinderSync

/// Finder Sync extension for Font Buttler.
///
/// This process never copies, activates, or installs a font. It asks
/// NSWorkspace to open the selected file URLs in the .app that contains
/// this appex, and attaches an Apple event that says Install or Install as….
/// The main app installs only after it has checked that sender. There is no
/// URL scheme: any page could open one.
///
/// Only `/` is monitored. Dropbox and iCloud Drive are File Provider domains,
/// and a Finder Sync menu often does not appear there. Services remain the
/// way to install from those folders.
private let fontExtensions: Set<String> = ["otf", "ttf", "ttc", "otc", "woff", "woff2"]

private let finderSyncEventClass = AEEventClass(0x46424653) // 'FBFS'
private let finderSyncEventID = AEEventID(0x68616e64) // 'hand'
private let finderSyncActionKeyword = AEKeyword(0x46424163) // 'FBAc'
private let finderSyncDirectObject = AEKeyword(0x2d2d2d2d) // keyDirectObject

@objc(FontButtlerFinderSync)
final class FontButtlerFinderSync: FIFinderSync {
    override init() {
        super.init()
        FIFinderSyncController.default().directoryURLs = [URL(fileURLWithPath: "/", isDirectory: true)]
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

    /// Open the selection in the containing app.
    /// `withApplicationAt` launches that app when it is not running.
    /// A missing bundle does nothing. This process does not fall back to a URL.
    private func handOff(action: String) {
        let selected = FIFinderSyncController.default().selectedItemURLs() ?? []
        let urls = selected.filter { isInstallSelection($0) && $0.isFileURL }
        guard !urls.isEmpty, let appURL = parentAppURL() else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.appleEvent = finderSyncAppleEvent(action: action, urls: urls)
        NSWorkspace.shared.open(urls, withApplicationAt: appURL, configuration: configuration) { _, _ in }
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

/// Apple event 'FBFS' / 'hand'. 'FBAc' is "install" or "install-as".
/// The direct object is the file list. The main app reads the sender audit token.
func finderSyncAppleEvent(action: String, urls: [URL]) -> NSAppleEventDescriptor {
    let event = NSAppleEventDescriptor(
        eventClass: finderSyncEventClass,
        eventID: finderSyncEventID,
        targetDescriptor: nil,
        returnID: AEReturnID(-1),
        transactionID: AETransactionID(0)
    )
    event.setDescriptor(NSAppleEventDescriptor(string: action), forKeyword: finderSyncActionKeyword)
    let list = NSAppleEventDescriptor.list()
    for url in urls {
        guard let item = NSAppleEventDescriptor(fileURL: url) else { continue }
        list.insert(item, at: list.numberOfItems + 1)
    }
    event.setDescriptor(list, forKeyword: finderSyncDirectObject)
    return event
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

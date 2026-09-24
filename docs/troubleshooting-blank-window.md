# Blank white window (macOS packaged app)

Font Buttler’s window loads the UI from a **local API** on `http://127.0.0.1:<port>`. If that service never starts or the React app crashes during render, you see a blank white window.

## Quick fixes

1. **Quit completely** — Font Buttler → Quit (not only closing the window if the menu bar icon is enabled), then reopen.
2. **Check for an error dialog** — Recent builds show a message if the local service failed to start instead of a silent blank window.
3. **Console.app** — Filter for `Font Buttler` or `Font Buttler API`. Look for `service init failed`, `CatalogCorruptError`, or `API worker exited`.

## Catalog corruption

Your library index lives at:

`~/Library/Application Support/Font Buttler/catalog.json`

(Older installs may use `Font Butler` in the path.)

If startup logs mention corrupt or invalid JSON:

1. Quit Font Buttler.
2. In that folder, rename `catalog.json` to `catalog.json.bad`.
3. If `catalog.json.bak` exists, leave it — the app may restore from backup on launch.
4. Reopen Font Buttler.

## Dev vs packaged

- **Development** (`npm run electron`) — Vite serves the UI on port 43181; the API runs separately. A blank window often means Vite or the API is not running.
- **Packaged `.app`** — UI and static files are served by the API worker. If the worker exits within ~20s or during catalog init, the main process cannot load the UI.

## GitHub release check

Settings → **Check for Updates** uses GitHub Releases with a short timeout. Failures are quiet and do **not** block startup. A blank window at launch is almost always the local API or a renderer crash, not the update check.

## Still stuck?

Open an issue at [displaay/font-butler](https://github.com/displaay/font-butler) with Console logs from one failed launch and whether renaming `catalog.json` changed anything.

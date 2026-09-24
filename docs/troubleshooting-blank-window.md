# Blank white window (macOS packaged app)

Font Buttler’s window loads the UI from a **local API** on `http://127.0.0.1:<port>`. If that service never listens, exits during startup, or the page fails to load JavaScript, you can see a blank white window or a startup error.

## Log console (temporary)

When the window is blank or shows an error, open **Show logs…** from the menu bar (tray) menu, **Help → Show logs…**, or press **⌘⌥L** (Cmd+Option+L). The log console works even if the font API never started.

It collects main-process messages, API worker output, load failures, and renderer warnings/errors. Lines are also written to `~/Library/Logs/Font Buttler/main.log` (with simple rotation). Use **Copy all** or **Reveal log file** when reporting an issue.

## Quick fixes

1. **Quit completely** — Font Buttler → Quit (not only closing the window when the menu bar icon is enabled), then reopen.
2. **Wait on first launch after an update** — Large libraries can take several minutes while fonts are indexed. The app should show “Starting…” or “Reading fonts…” rather than staying blank once the service is listening.
3. **Console.app** — Filter for `Font Buttler` or `Font Buttler API`. Useful lines:
   - `Font Buttler API on http://127.0.0.1:…` — service is listening
   - `Font Buttler init complete` — library finished loading
   - `service init failed` — startup aborted (see stderr in the same log)

## Catalog or library data

Data lives under:

`~/Library/Application Support/Font Buttler/`

(Older installs may use `Font Butler` in the path.)

**Do not rename `catalog.json` alone.** If the file is missing, the app may start empty and the next save can overwrite `catalog.json.bak`.

If the log shows corrupt JSON or `CatalogCorruptError`:

1. Quit Font Buttler completely.
2. If `catalog.json.bak` looks intact, copy it over `catalog.json`.
3. Otherwise move the **whole** `Font Buttler` data folder aside and relaunch (you start fresh; the old folder remains as backup).

## Stuck after a failed launch

If an earlier launch failed but the menu bar icon remains, a hidden process may still hold the single-instance lock. Quit from the menu bar → Quit, or force quit from Activity Monitor, then open again.

## Dev vs packaged

- **Development** (`npm run electron`) — Vite serves the UI on port 43181; the API runs separately.
- **Packaged `.app`** — UI and static files are served by the API worker. The worker listens first; heavy library work runs in the background.

## GitHub release check

Settings → **Check for Updates** uses GitHub Releases with a short timeout. Failures are quiet and do **not** block startup.

## Still stuck?

Open an issue at [displaay/font-butler](https://github.com/displaay/font-butler) with Console logs from one failed launch (from “API on” through “init complete” or the error).

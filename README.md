# Font Buttler

A source-tracked font manager for macOS — a simpler stand-in for Font Book.

Drop a font file into Font Buttler and it remembers the original path. When that source file changes, Font Buttler offers a reinstall. Reinstalling uninstalls the old copy, clears user font caches (including Microsoft Office and Adobe font caches when present), then installs the new file.

## Features

- **Watch folders** — Point Font Buttler at a folder of sources. New files are imported automatically; you choose whether they also install. Pause a folder, pick a destination policy per folder, or drop a folder once without watching it.
- **Format swap** — Keep OTF and TTF of the same family in the library, then **Swap OTF for TTF** (or the other way) in one step. The other format stays on the card, deactivated, so you can swap back.
- **Install as…** — Rewrite the family name across OpenType name (and CFF) tables and install a copy. The original file is never mutated. The packaged app ships Python and fonttools, so this works without a system Python.
- **Bake OpenType features** — Turn stylistic sets, figures, and other features on in the specimen, then bake them into a reinstall or a new **Install as…** copy.
- **Destinations** — Install to `~/Library/Fonts`, an Adobe folder, or both. Watch-folder and drop policies can follow that choice.
- **Activate, deactivate, uninstall** — Same user-font workflow as Font Book. Uninstalling removes the copy from the destination; a tracked source stays in the library as **Not installed**.
- **Source tracking and updates** — The **Source** badge means the original file is still on disk. When it changes, the family shows as outdated and you can reinstall (or auto-reinstall). Removing the source does not uninstall the font.
- **Projects** — Named sets of families you can activate or deactivate together, and pin so a project keeps a specific installed version.
- **Specimen and glyphs** — Live preview with variable-axis sliders, OpenType feature toggles, side-by-side compare, and a searchable glyph grid. Cards pick a sample glyph from cmap coverage (Latin **Aa**, or the face’s script / specialty sample).
- **Library filters** — Status, type (VF / static), source, destination (computer / Adobe / none), and format (OTF / TTF) chips, plus saved filters and per-folder views.
- **On this Mac** — Browse computer and system fonts and remove ones that are not protected.
- **Caches** — Reinstall and the **Font cache** menu can clear the user ATS cache, Microsoft Office `FontCache`, and Adobe font list caches when those options are on.
- **Displaay retail** — Optional sync with the Displaay worker. **Check** lists every remote font on the Displaay retail tab, even when a copy is already in the catalogue or not installed. **Sync** installs free slots; installing a listed font replaces the occupying catalogue copy. Listings cannot be removed. See [docs/retail-sync.md](docs/retail-sync.md).

## What it does

- Shows Font Book’s **My Fonts** (`~/Library/Fonts`) on the Fonts tab as soon as the app opens
- Groups families, counts instances, and marks variable fonts with a **VF** badge
- Right-click a card → **Show in Finder**
- If Font Buttler is the default app for a font, double-clicking the file adds it to the library and installs it immediately
- Right-click a font file or a folder of fonts in Finder → **Install** or **Install as…** (Finder menu). **Install as…** asks for a destination and family name, then uses the same install path as the app. Enable the menu once in **System Settings → General → Login Items & Extensions**. **Link to …** stays under Services and opens Font Buttler so you can pick an existing catalog family and attach this file as its tracked source.

## Run on your Mac

```bash
npm install
npm run electron
```

To replace Font Book as the double-click handler: select a `.otf` or `.ttf` in Finder, **Get Info → Open with → Font Buttler → Change All**.

Finder **Install** and **Install as…** are a Finder Sync menu on font files (`.otf`, `.ttf`, `.ttc`, `.otc`, `.woff`, `.woff2`) and on folders in your home folder, `/Users/Shared`, and `/Volumes`. The extension sends the selection to the Font Buttler app that contains it, over that build's app-group Mach service. The app and the extension list the same team-prefixed group (`A7WWML89LQ.group.` plus the appex bundle ID), which is the form macOS 15 accepts without asking to access data from other apps. The app installs the files only after the connection's code signature matches team `A7WWML89LQ` and this build's Finder Sync identifier. A click launches that app when it is not already running, and the app installs the files through the same `/api/import` then `/api/install` path Services use, including a folder of fonts. More than 500 files, or more than 2 GB, is refused. Turn the menu on once in **System Settings → General → Login Items & Extensions** (first launch and Settings both have a button that opens that pane). While the extension is off, Finder shows no Font Buttler menu and the app does not turn it back on. Inside Dropbox or iCloud folders the Finder menu may not appear; use Services there (right-click > Services > Install). A test build (`FONT_BUTLER_TEST_FEED_BUILD=1`) uses the menu titles **Install (Test)** and **Install as… (Test)**, its own extension bundle ID, and its own app group, so it hands files to that build only. The same **Install**, **Install as…**, and **Link to …** actions remain macOS Services for `.otf`, `.ttf`, `.ttc`, `.otc`, and other font UTIs the app already claims. Run the packaged app once so Launch Services can pick the Services up. If those items are missing, enable them in **System Settings → Keyboard → Keyboard Shortcuts → Services**. **Link to …** pairs each selected file to at most one style in the family you pick (`inspectRelink` + `applyRelink`). Extra files that don’t match stay in the queue until you dismiss; a file already linked to that style is skipped.

Font Buttler installs copies into `~/Library/Fonts`, the same user font folder Font Book uses. Fonts already there show up on the Fonts tab on launch. Catalog data lives in `~/Library/Application Support/Font Buttler/`.

### Font cache menu

**Font cache** in the menu bar can remove the user ATS cache or, when enabled in Settings, Microsoft Office’s `FontCache` folder and Adobe font list caches (`AdobeFnt*.lst`, InDesign Font Cache, Type Support). Reinstall also clears those caches only when the matching option is on. Open Adobe apps still need a relaunch.

### Optional full cache reset

Font Buttler clears the **user** ATS cache, Office’s `FontCache` folder, and Adobe font list caches. A machine-wide wipe still needs:

```bash
sudo atsutil databases -remove
```

then a restart.

## UI-only preview

```bash
npm install
npm run dev
```

Opens the React app at `http://127.0.0.1:43181`. Native macOS cache commands are skipped on Linux; installs go into a project-local vault (`.font-butler-data/`).

Open-with can be simulated with:

```
http://127.0.0.1:43181/?open=/absolute/path/to/font.ttf
```

## Stack

Electron + Vite + React + TypeScript. Font metadata comes from `fontkit`. Family renaming prefers Python `fonttools` (`scripts/rename_family.py`) and falls back to a JavaScript name-table rewrite for TTF/OTF.

The packaged macOS app ships its own CPython and `fonttools`, so “Install as…” does not need a system Python. `npm run dist` downloads that runtime into `vendor/python`. From source, install fonttools (`python3 -m pip install fonttools`) or run `npm run bundle:python`.

## Displaay retail collection

An optional collection can be kept in step with the Displaay worker. Turn it on in
**Settings → Watch folders**, then use **Check** to see what changed on the server and **Sync All** (or a per-family On switch) to pull it down. Turning Sync on
loads the list without downloading; an interrupted sync resumes on the next launch. Turning Sync off
asks whether to keep the fonts installed or uninstall them and remove them from the library. Background
checks still do not run at startup. Fonts flatten into
`~/Library/Fonts` (no separate source folder on disk). Without a token of your own the app uses its
built-in trial token and syncs the Displaay trial fonts (marked **Trial**); a token with retail access
replaces them with the full files. See [docs/retail-sync.md](docs/retail-sync.md).

## App updates

Font Buttler compares its running version to the latest [GitHub Release](https://github.com/displaay/font-butler/releases). When a newer release exists, a blue **Update** badge appears on **Settings** in the left column. Click that badge to download and install the release. Nothing is downloaded until the click, and further clicks are ignored while a download is already running. The Updates tab lists font updates only.

The install path follows the signature of the running app, not its version number:

- A packaged build signed with Developer ID for team `A7WWML89LQ`, from a writable location, is replaced in place and relaunched. The downloaded app must be signed by that same team, carry a notarization staple, and match the sha512 and size in `latest-mac.yml`.
- Anything else downloads the DMG, checks those same bytes, and opens it. That includes `npm run electron`, an ad-hoc or unsigned build, an app launched from the mounted DMG or from App Translocation, and a bundle folder that is not writable.

The download is unauthenticated and does not send a GitHub token. GitHub redirects release files to `release-assets.githubusercontent.com` (older files used `objects.githubusercontent.com`). Every redirect hop has to stay on an allowlisted host, and a checksum mismatch leaves the current app untouched.

People on 0.3.8 or earlier are on an ad-hoc build whose badge does not install. Download the first signed version by hand once and replace the app. After that, later releases use the badge.

The check is not on the cold-start path and times out after a few seconds so a hung GitHub fetch cannot stall first paint. Offline or GitHub failures stay quiet. A public repo needs no token. A private repo can set a read-only `FONT_BUTLER_GITHUB_TOKEN` for the version check only, until Releases are public (see [docs/releases.md](docs/releases.md)). That token is never sent with the file download.

`FONT_BUTLER_UPDATE_FEED_URL` points a non-release run at a local feed (`http://127.0.0.1`, `http://localhost`, or a `file://` directory that contains `latest-mac.yml`) so a newer signed build can be tried without publishing. A packaged Developer ID build ignores it unless it was packed with `FONT_BUTLER_TEST_FEED_BUILD=1`. Those marked builds are never uploaded. See [docs/releases.md](docs/releases.md).

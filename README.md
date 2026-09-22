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
- Right-click a font file in Finder → **Install**, **Install as…**, or **Link to …** (Services). **Install as…** asks for a destination and family name, then uses the same install path as the app. **Link to …** opens Font Buttler so you can pick an existing catalog family and attach this file as its tracked source.

## Run on your Mac

```bash
npm install
npm run electron
```

To replace Font Book as the double-click handler: select a `.otf` or `.ttf` in Finder, **Get Info → Open with → Font Buttler → Change All**.

Finder **Install**, **Install as…**, and **Link to …** are macOS Services. They appear on `.otf`, `.ttf`, `.ttc`, `.otc`, and other font UTIs the app already claims. Run the packaged app once so Launch Services can pick them up. If the items are missing, enable them in **System Settings → Keyboard → Keyboard Shortcuts → Services**. Selecting several font files at once installs each file through the same `/api/import` then `/api/install` path the library uses. **Link to …** pairs each selected file to at most one style in the family you pick (`inspectRelink` + `applyRelink`). Extra files that don’t match stay in the queue until you dismiss; a file already linked to that style is skipped.

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

Font Buttler compares its running version to the latest [GitHub Release](https://github.com/displaay/font-butler/releases). When a newer release exists, Settings, the Updates tab, and the menu bar show the version, notes, **Download**, and **Open release**. Nothing is downloaded or installed automatically. The check is not on the cold-start path and times out after a few seconds so a hung GitHub fetch cannot stall first paint. Offline or GitHub failures stay quiet. A public repo needs no token; a private repo needs a read-only `FONT_BUTLER_GITHUB_TOKEN` until Releases are public (see [docs/releases.md](docs/releases.md)).

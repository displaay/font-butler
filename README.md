# Font Buttler

A source-tracked font manager for macOS — a simpler stand-in for Font Book.

Drop a font file into Font Buttler and it remembers the original path. When that source file changes, Font Buttler offers a reinstall. Reinstalling uninstalls the old copy, clears user font caches (including Microsoft Office and Adobe font caches when present), then installs the new file.

## What it does

- Shows Font Book’s **My Fonts** (`~/Library/Fonts`) on the Fonts tab as soon as the app opens
- Tracks a separate source file when you drop or watch one. A **Source** badge means that original file is still on disk; removing it does not uninstall the font
- Groups families, counts instances, and marks variable fonts with a **VF** badge
- Shows a live preview glyph on every card. Latin fonts use **Aa** (or **AA** when the face is caps-only); Hebrew, Arabic, Hangul, Thai, Indic, CJK, emoji, Braille, and symbol fonts use a Font Book-style representative from cmap coverage
- Installs, uninstalls, and deactivates user fonts in place, like Font Book. Uninstalling removes the file from `~/Library/Fonts`. If a separate source file is still on disk, the family stays on the Fonts list as **Not installed**; otherwise it leaves the list
- **Install as…** rewrites the family name across OpenType name (and CFF) tables, then installs a copy. The original file is never mutated
- **On this Mac** lists computer and system fonts and lets you remove ones that are not protected
- Right-click a card → **Show in Finder**
- If Font Buttler is the default app for a font, double-clicking the file adds it to the library and installs it immediately

## Run on your Mac

```bash
npm install
npm run electron
```

To replace Font Book as the double-click handler: select a `.otf` or `.ttf` in Finder, **Get Info → Open with → Font Buttler → Change All**.

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

## App updates

Font Buttler compares its running version to the latest [GitHub Release](https://github.com/displaay/font-butler/releases). When a newer release exists, Settings, the Updates tab, and the menu bar show the version, notes, **Download**, and **Open release**. Nothing is downloaded or installed automatically. The check is not on the cold-start path and times out after a few seconds so a hung GitHub fetch cannot stall first paint. Offline or GitHub failures stay quiet. A public repo needs no token; a private repo needs a read-only `FONT_BUTLER_GITHUB_TOKEN` until Releases are public (see [docs/releases.md](docs/releases.md)).

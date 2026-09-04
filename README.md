# Font Buttler

A source-tracked font manager for macOS — a simpler stand-in for Font Book.

Drop a font file into Font Buttler and it remembers the original path. When that source file changes, Font Buttler offers a reinstall. Reinstalling uninstalls the old copy, clears user font caches (including Microsoft Office’s cache when present), then installs the new file.

## What it does

- Tracks source files and last-modified time
- Groups families, counts instances, and marks variable fonts with a **VF** badge
- Shows a live **Aa** preview on every card
- Installs, uninstalls, and deactivates user fonts
- **Install as…** rewrites the family name across OpenType name (and CFF) tables, then installs a copy. The original file is never mutated
- Lists fonts already on the computer and lets you remove ones that are not protected
- Right-click a card → **Show in Finder**
- If Font Buttler is the default app for a font, double-clicking the file adds it to the library and installs it immediately

## Run on your Mac

```bash
npm install
npm run electron
```

To replace Font Book as the double-click handler: select a `.otf` or `.ttf` in Finder, **Get Info → Open with → Font Buttler → Change All**.

Font Buttler installs copies into `~/Library/Fonts/Font Buttler/`. Catalog data lives in `~/Library/Application Support/Font Buttler/`.

### Font cache menu

**Font cache** in the menu bar can remove the user ATS cache or, when enabled in Settings, Microsoft Office’s `FontCache` folder. Reinstall also clears Office’s cache only when that option is on.

### Optional full cache reset

Font Buttler clears the **user** ATS cache and Office’s `FontCache` folder. A machine-wide wipe still needs:

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

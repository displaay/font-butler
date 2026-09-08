# GitHub Releases

Font Buttler checks [GitHub Releases](https://github.com/displaay/font-butler/releases) for a newer app version. It never downloads or installs that build by itself.

## How the app reads releases

1. The local API `GET /api/app-update` calls GitHub’s public latest-release endpoint:

   `https://api.github.com/repos/displaay/font-butler/releases/latest`

   Drafts and prereleases are skipped (that is GitHub’s `/latest` contract). A personal token is not required. `FONT_BUTLER_GITHUB_TOKEN` or `GITHUB_TOKEN` is used only when present, to raise the unauthenticated rate limit.

2. The tag (`v0.2.0` or `0.2.0`) is compared to `package.json` `version` (the running app). Newer means the UI and menu bar can show notes and a link.

3. Results are cached for one hour. **Check for Updates…** (app menu) and **Check for updates** in Settings → General → App updates pass `?refresh=1`. The menu bar also rechecks about every six hours.

4. Surfaces:

   - **Settings → General → App updates** — current version, notes, **Open on GitHub**, optional asset link
   - **Updates** tab — same card when a newer release exists (font **Reinstall** is unchanged)
   - **Menu bar → Updates** — `Font Buttler {version}` opens the release page; **Reinstall all fonts** still only reinstalls fonts
   - **Font Buttler → Check for Updates…** — refreshes, then focuses Settings

Install and Switch are not part of this path.

## How to cut a release

1. Bump `version` in `package.json` (semver, no leading `v`).
2. `npm test && npm run lint && npm run build`
3. Commit, then tag the same version:

   ```bash
   git tag v0.2.0
   git push origin main v0.2.0
   ```

4. Package on a Mac:

   ```bash
   npm run dist
   ```

   `npm run dist` does **not** publish. Artifacts land in `release/` as:

   `Font-Buttler-{version}-{arch}.{ext}`

   Examples: `Font-Buttler-0.2.0-arm64.dmg`, `Font-Buttler-0.2.0-arm64.zip`. Ship both the **dmg** (people) and the **zip** (later `electron-updater`).

5. Create a GitHub Release for that tag. Paste a changelog (Keep a Changelog / “What’s new” markdown). Attach the dmg and zip. Publish it (not a draft, not a prerelease) so `/releases/latest` returns it.

6. Optional publish from a signed Mac with a `GH_TOKEN` that can write releases:

   ```bash
   npx electron-builder --mac --publish always
   ```

## Parked: signed auto-update

Auto-download and auto-install are **parked** (`autoInstall: "parked"` in the API). Do not wire `autoDownload` or `autoInstallOnAppQuit` until the app is Developer ID signed and notarized.

When signing lands:

1. Sign and notarize the Mac app (`hardenedRuntime`, `entitlements`, notarize hook).
2. Add `electron-updater` with the GitHub provider (`owner: displaay`, `repo: font-butler`). Keep **`autoDownload: false`** and **`autoInstallOnAppQuit: false`**.
3. Keep the current “Open on GitHub” path as the default.
4. Add an explicit **Install {version}** action that is the only thing that may download, then install on quit.
5. Confirm `latest-mac.yml` (and matching zip) is attached to the GitHub Release.
6. Only then consider auto-download for users who opt in.

The stub is `startParkedAutoInstall()` in `shared/app-update.ts`. It throws on purpose.

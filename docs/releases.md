# GitHub Releases

Font Buttler checks [GitHub Releases](https://github.com/displaay/font-butler/releases) for a newer app version. It never downloads or installs that build by itself.

## How the app reads releases

1. The local API `GET /api/app-update` calls GitHub’s latest-release endpoint:

   `https://api.github.com/repos/displaay/font-butler/releases/latest`

   Drafts and prereleases are skipped (that is GitHub’s `/latest` contract).

2. **Auth**

   - **Public repo / public releases** — no token. Unauthenticated reads work.
   - **Private repo** — unauthenticated `GET /releases/latest` returns 404 (GitHub hides the repo). Font Butler treats that as a quiet no-update, so the app looks up to date. Until Releases are public, set a **read-only** token in `FONT_BUTLER_GITHUB_TOKEN` (or `GITHUB_TOKEN` as a fallback). Fine-grained: Contents read on `displaay/font-butler`. The token is used only for this check, not for Install, Switch, or the local API.

     ```bash
     FONT_BUTLER_GITHUB_TOKEN=ghp_... npm run electron
     ```

3. The tag (`v0.2.0` or `0.2.0`) is compared to `package.json` `version` (the running app). Newer means the UI and menu bar can show notes and a link.

4. Results are cached for one hour. **Check for Updates…** (app menu) and **Check for updates** in Settings → General → App updates pass `?refresh=1`. The menu bar also rechecks about every six hours. The GitHub fetch has a 4s timeout. Cold start does not wait on it: the UI paints, then the check runs in the background.

5. Surfaces:

   - **Settings → General → App updates** — current version, notes, **Download** (asset, opens in the browser to save), **Open release**
   - **Updates** tab — same card when a newer release exists (font **Reinstall** is unchanged)
   - **Menu bar → Updates** — `Font Buttler {version}` opens the release page; **Download {asset}** opens the file; **Reinstall all fonts** still only reinstalls fonts
   - **Font Buttler → Check for Updates…** — refreshes, then focuses Settings

Install and Switch are not part of this path. Offline, GitHub API failures, or a private-repo 404 without a token stay a quiet no-update: no crash, no toast, no Install/Switch/auth churn. A last-good check is kept if one exists.

## How to cut a release

1. Bump `version` in `package.json` (semver, no leading `v`).
2. Commit that bump on `main`.
3. Tag that commit and push the tag:

   ```bash
   git tag -a v0.3.2 -m "v0.3.2"
   git push origin main v0.3.2
   ```

   Use an annotated tag. A lightweight `v*` tag starts the same workflow. The tag (`v0.3.2`) must match `package.json` (`0.3.2`).

4. [`.github/workflows/release.yml`](../.github/workflows/release.yml) then:

   - runs tests, lint, and build on Ubuntu
   - on a macOS arm64 runner, runs `npm run dist`
   - publishes a GitHub Release for that tag (not a draft, not a prerelease)

   Attached files:

   - `Font-Buttler-{version}-arm64.dmg`
   - `Font-Buttler-{version}-arm64.zip`
   - `Font-Buttler-{version}-arm64.zip.blockmap`
   - `latest-mac.yml` (electron-updater feed)

   Release notes are generated from commits since the previous tag. Edit them on GitHub if you want a tighter changelog.

   `npm run dist` still uses `--publish never`. electron-builder writes `latest-mac.yml` and the zip blockmap next to the dmg; the workflow uploads them. Do not also run `electron-builder --publish always`, or two publishers will fight over the same Release.

   Do **not** set `CSC_IDENTITY_AUTO_DISCOVERY=false`. That skips signing and leaves Electron’s linker-signed binaries in an unsigned app bundle. Gatekeeper then reports the downloaded app as damaged until `xattr -cr`. `npm run dist` ad-hoc signs (`mac.identity: "-"`), strips copyable xattrs, and sets `COPYFILE_DISABLE=1` so resource forks are not packed.

   A freshly downloaded dmg should open without `xattr -cr`. Gatekeeper may still ask the user to confirm an unidentified developer. Opening with **no** Gatekeeper prompt requires a Developer ID certificate and notarization; this repo has neither yet.

5. Confirm the Release is public so `/releases/latest` returns it.

To package on GitHub Actions without publishing, open **Actions → Release → Run workflow** and leave **publish** off.

## Parked: signed auto-update

Auto-download and auto-install are **parked** (`autoInstall: "parked"` in the API). Do not wire `autoDownload` or `autoInstallOnAppQuit` until the app is Developer ID signed and notarized.

When signing lands:

1. Remove `mac.identity: "-"` so electron-builder uses a Developer ID certificate. Keep `hardenedRuntime` and the entitlements in `build/entitlements.mac.plist`. Add a notarize hook.
2. Add `electron-updater` with the GitHub provider (`owner: displaay`, `repo: font-butler`). Keep **`autoDownload: false`** and **`autoInstallOnAppQuit: false`**.
3. Keep the current **Download** / **Open release** path as the default.
4. Add an explicit **Install {version}** action that is the only thing that may download, then install on quit.
5. The release workflow already attaches `latest-mac.yml`, the zip, and the zip blockmap. After notarization, confirm those assets are on the GitHub Release.
6. Only then consider auto-download for users who opt in.

The stub is `startParkedAutoInstall()` in `shared/app-update.ts`. It throws on purpose.

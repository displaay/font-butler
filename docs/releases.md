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
   - **Menu bar → Updates** — `Font Buttler {version}` opens the release page; **Download {asset}** opens the file; **Reinstall all fonts** still only reinstalls fonts

   The **Updates** tab lists font updates only. An application release does not appear there.
   - **Font Buttler → Check for Updates…** — refreshes, then focuses Settings

Install and Switch are not part of this path. Offline, GitHub API failures, or a private-repo 404 without a token stay a quiet no-update: no crash, no toast, no Install/Switch/auth churn. A last-good check is kept if one exists.

## How to cut a signed release

Signed releases are built on the release Mac (the machine whose login keychain has `Developer ID Application: DANIEL QUISEK (A7WWML89LQ)`). GitHub Actions does not have that certificate or the notary profile.

### One-time: store notary credentials

On that Mac, store an app-specific password in the login keychain. `notarytool` prompts for the password. Do not commit it, and do not put a `.p12` or an API key in the repo.

```bash
xcrun notarytool store-credentials font-butler-notary \
  --apple-id daniel@quisek.com \
  --team-id A7WWML89LQ
```

The profile name is `font-butler-notary`. If it lives in a keychain other than the default login keychain, set `APPLE_KEYCHAIN` to that keychain’s path when you pack.

### Each release

1. Bump `version` in `package.json` (semver, no leading `v`).
2. Commit that bump on `main`.
3. On the release Mac, from a clean checkout of that commit:

   ```bash
   npm run release:mac
   ```

   `release:mac` sets `APPLE_KEYCHAIN_PROFILE=font-butler-notary` when that variable is unset, then runs the same prepare steps as `npm run dist` (`build`, bundled Python, Finder and session-font addons) and packs with electron-builder `--publish never`. Signing is forced. If the Developer ID certificate is missing, the command fails instead of falling back to ad-hoc.

4. Verify the app (Apple silicon build; the bundle is `release/mac-arm64/Font Buttler.app`):

   ```bash
   APP="release/mac-arm64/Font Buttler.app"
   codesign --verify --deep --strict --verbose=2 "$APP"
   codesign -d --entitlements :- "$APP"
   spctl -a -vvv -t exec "$APP"
   xcrun stapler validate "$APP"
   ```

   `codesign -d --entitlements :-` should show `allow-jit` and `allow-unsigned-executable-memory`, and should not show `disable-library-validation`. `spctl` should report `source=Notarized Developer ID`. `stapler validate` should say the ticket is stapled.

   Nested code is signed with the same identity. Spot-check one of each:

   ```bash
   codesign --verify --verbose=2 "$APP/Contents/Frameworks/Font Buttler Helper (Renderer).app"
   codesign --verify --verbose=2 "$APP/Contents/Resources/app.asar.unpacked/electron/finder-services.node"
   codesign --verify --verbose=2 "$APP/Contents/Resources/python/bin/python3"
   ```

5. Upload the artifacts onto the GitHub Release for that version (create the Release first if the tag workflow has not). From the release Mac:

   ```bash
   version="$(node -p "require('./package.json').version")"
   gh release upload "v${version}" \
     "release/Font-Buttler-${version}-arm64.dmg" \
     "release/Font-Buttler-${version}-arm64.zip" \
     "release/Font-Buttler-${version}-arm64.zip.blockmap" \
     "release/latest-mac.yml" \
     --clobber
   ```

   Attached files:

   - `Font-Buttler-{version}-arm64.dmg`
   - `Font-Buttler-{version}-arm64.zip`
   - `Font-Buttler-{version}-arm64.zip.blockmap`
   - `latest-mac.yml` (updater feed; electron-updater is not wired yet)

6. Confirm the Release is public so `/releases/latest` returns it.

Tag push still starts [`.github/workflows/release.yml`](../.github/workflows/release.yml). That job runs tests on Ubuntu and `npm run dist` on a macOS runner, then publishes a Release. The runner has no Developer ID certificate, so `npm run dist` **ad-hoc signs** and does not notarize. Those assets are not the signed release. After `npm run release:mac`, upload with `--clobber` so the notarized dmg, zip, blockmap, and `latest-mac.yml` replace them.

`npm run release:mac` and `npm run dist` both pass `--publish never`. electron-builder still writes `latest-mac.yml` and the zip blockmap next to the dmg. Do not also run `electron-builder --publish always`.

To package on GitHub Actions without publishing, open **Actions → Release → Run workflow** and leave **publish** off. That package is still the ad-hoc fallback.

## Signing

electron-builder is 26.15.3 (`@electron/notarize` 2.5.0). No upgrade. `mac.notarize: true` turns on the built-in notarize step. That step runs only when one of electron-builder’s credential sets is present. This repo uses the keychain profile:

- `APPLE_KEYCHAIN_PROFILE` (required for notarization)
- `APPLE_KEYCHAIN` (optional; default is the login keychain)

`@electron/notarize` submits the `.app`, waits, and staples the ticket onto the bundle before the dmg and zip are built. The zip and dmg therefore contain an already stapled app, and `latest-mac.yml` hashes that zip.

### Identity

`mac.identity` is `DANIEL QUISEK (A7WWML89LQ)`. That is electron-builder’s format: the `Developer ID Application:` prefix must not be included. The name is pinned so auto-discovery cannot pick an Apple Development certificate on the same Mac.

`hardenedRuntime` is `true`. Entitlements are `build/entitlements.mac.plist` for the app and, via `entitlementsInherit`, for every nested binary electron-builder signs.

### Entitlements

The Developer ID plist has:

- `com.apple.security.cs.allow-jit` — V8 on Apple silicon (Electron 20+)
- `com.apple.security.cs.allow-unsigned-executable-memory` — V8’s writable executable memory

It does **not** set `com.apple.security.cs.disable-library-validation`. That entitlement is for loading code signed by someone else. A Developer ID build re-signs the whole bundle with one team, so library validation should accept it. The same inherit plist is applied to Electron Helper apps (the Renderer and GPU helpers need `allow-jit`), the unpacked native addons, and the bundled Python Mach-O files. `allow-unsigned-executable-memory` on those nested files is wider than Python needs; electron-builder has one inherit file, not a per-binary plist.

If a notarized build dies at launch with a library-validation crash in Python or a `.node` addon, add `disable-library-validation` to `build/entitlements.mac.plist` and ship another build. Do not add it preemptively.

### What gets signed

`@electron/osx-sign` walks `Contents` and signs Mach-O files, `.app` bundles, and frameworks, deepest first. Nothing is `signIgnore`’d, and no extra `binaries` list is required, because the extra code already lives inside the bundle:

- Electron frameworks and Helper apps, including the Utility helper used by `utilityProcess.fork` for the packaged API. Worker threads are threads in that process, not separate executables.
- `finder-services.node` and `session-fonts.node`, compiled in the `afterPack` hook, which runs before signing, and unpacked via `asarUnpack: "**/*.node"`.
- The bundled CPython under `Contents/Resources/python` (`extraResources`). Scripts are not Mach-O and are not signed; `python3` and its `.so` / `.dylib` files are.

Do **not** set `CSC_IDENTITY_AUTO_DISCOVERY=false`. That skips signing and leaves Electron’s linker-signed binaries inside an unsigned bundle. Gatekeeper then reports the download as damaged until `xattr -cr`. Both pack scripts set `COPYFILE_DISABLE=1`, and the after-pack hook strips copyable xattrs before signing so resource forks are not sealed into the bundle. The hook does not run again after stapling.

### The DMG is not signed or stapled on its own

The dmg is a release download. It is still an unsigned container around the stapled app.

electron-builder notarizes during `sign()`, then builds the dmg and zip. `dmg.sign` defaults to false, and electron-builder’s own note says signing the dmg is not required and leads to Gatekeeper errors when the notarization ticket is for the app rather than the disk image. Stapling the dmg afterwards would change the file after `latest-mac.yml` and the zip blockmap are hashed.

Gatekeeper assesses `Font Buttler.app` inside the dmg. The staple is on that app, so the check works offline. The zip used for a future updater is the same stapled app. `xcrun stapler validate` applies to the `.app`, not to the dmg.

### Local and CI builds

These rows are for a Mac. On Linux, electron-builder skips macOS signing, and `npm run release:mac` exits before it packs.

| Command | Certificate missing | Certificate present, no profile | `release:mac` |
| --- | --- | --- | --- |
| `npm run build` | Does not sign or pack | Does not sign or pack | — |
| `npm run dist` | Ad-hoc sign (`identity: "-"`), hardened runtime, `build/entitlements.mac.adhoc.plist` (this file does disable library validation, because ad-hoc signatures have no shared team). Notarization off. Does not fail. | Developer ID sign, no notarization | — |
| `npm run release:mac` | Fails (`forceCodeSigning`) | — | Developer ID sign, profile `font-butler-notary`, notarize, staple. macOS only. |

Notarization runs only when `APPLE_KEYCHAIN_PROFILE` is set. `npm run dist` does not set it. A half-set `APPLE_ID` / API-key trio is removed from the pack environment so it cannot abort a local build; the only notary credentials this repo passes through are the keychain profile and optional `APPLE_KEYCHAIN`.

`npm run electron` and `npm run dev` are unsigned dev runs. They do not call electron-builder.

## Auto-update from an ad-hoc build

The in-app check does not use `electron-updater`. **Download** and **Open release** open the browser. Nothing is downloaded or installed by the app. `autoInstall` stays `"parked"`. `startParkedAutoInstall()` in `shared/app-update.ts` throws on purpose.

`latest-mac.yml` is still uploaded so a later updater has a feed. Do not switch that on in this signing change.

Squirrel.Mac (what `electron-updater` uses on macOS) accepts an update only when the new app satisfies the **running** app’s designated requirement:

- An ad-hoc signature’s requirement is tied to that build’s code directory hash. It does not match a Developer ID signature, and it does not match the next ad-hoc build either.
- A Developer ID signature’s requirement is stable for the team (`A7WWML89LQ`): identifier, Apple anchor, and the Developer ID leaf. Later builds signed with the same certificate satisfy it.

So anyone on an ad-hoc Font Buttler (every GitHub Release built before Developer ID signing, and any `npm run dist` from a machine or Actions runner without the certificate) **cannot auto-update** to the first Developer ID build. They download the dmg once and replace the app. After that, a future Developer ID build can be an auto-update, if electron-updater is wired with `autoDownload: false` and `autoInstallOnAppQuit: false` and an explicit Install action.

Until that wiring exists, every user, including people already on a Developer ID build, still updates by downloading the release.

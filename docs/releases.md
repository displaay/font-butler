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

Signed releases are built on the release Mac (the machine whose login keychain has `Developer ID Application: DANIEL QUISEK (A7WWML89LQ)`). GitHub Actions does not have that certificate or the notary profile, and its publish step refuses an ad-hoc package.

Run the release build from a clean worktree of `origin/main` (after the version bump is on `main`):

```bash
git fetch origin main
git worktree add ~/git/font-butler-release origin/main
cd ~/git/font-butler-release
npm ci
```

### One-time: store notary credentials

On that Mac, store an app-specific password in the login keychain. `notarytool` prompts for the password. Do not commit it, do not put it in a log, and do not put a `.p12` or an API key in the repo.

```bash
xcrun notarytool store-credentials font-butler-notary \
  --apple-id <your-apple-id> \
  --team-id A7WWML89LQ
```

The profile name is `font-butler-notary`. If it lives in a keychain other than the default login keychain, set `APPLE_KEYCHAIN` to that keychain’s path when you pack. Do not set `APPLE_ID` or `APPLE_APP_SPECIFIC_PASSWORD` in the environment. The pack scripts delete those variables and pass only the keychain profile.

### Each release

1. Bump `version` in `package.json` (semver, no leading `v`).
2. Commit that bump on `main` and push it.
3. From the clean worktree above, tag that commit and push the tag. `npm run publish:mac` does not create the tag. If `v<version>` is not on `origin`, it stops.

   ```bash
   version="$(node -p "require('./package.json').version")"
   git tag "v${version}"
   git push origin "v${version}"
   ```

4. Build the signed app from that same worktree:

   ```bash
   npm run release:mac
   ```

   `release:mac` sets `APPLE_KEYCHAIN_PROFILE=font-butler-notary` when that variable is unset, then runs the same prepare steps as `npm run dist` (`build`, bundled Python, Finder and session-font addons) and packs with electron-builder `--publish never`. Signing is forced. If the Developer ID certificate is missing, or signing or notarizing fails, the command stops. It does not fall back to ad-hoc. After a successful pack it runs `scripts/assert-notarized-mac-release.mjs`.

5. Verify the app, the DMG, and the update zip (Apple silicon build; the bundle is `release/mac-arm64/Font Buttler.app`):

   ```bash
   APP="release/mac-arm64/Font Buttler.app"
   DMG="release/Font-Buttler-$(node -p "require('./package.json').version")-arm64.dmg"
   codesign --verify --deep --strict --verbose=2 "$APP"
   codesign -d --entitlements :- "$APP"
   spctl -a -vv -t exec "$APP"
   spctl -a -vvv -t exec "$APP"
   xcrun stapler validate "$APP"
   xcrun stapler validate "$DMG"
   ```

   `codesign -d --entitlements :-` should show `allow-jit` only. It should not show `allow-unsigned-executable-memory`, `disable-library-validation`, or `get-task-allow`. `spctl -a -vv` should report `Notarized Developer ID`. `stapler validate` should pass on both the app and the DMG.

   Nested code is signed with the same identity. Spot-check one of each:

   ```bash
   codesign --verify --verbose=2 "$APP/Contents/Frameworks/Font Buttler Helper (Renderer).app"
   codesign --verify --verbose=2 "$APP/Contents/Resources/app.asar.unpacked/electron/finder-services.node"
   codesign --verify --verbose=2 "$APP/Contents/Resources/python/bin/python3"
   ```

6. Upload a draft from the release Mac. This checks the staple for `Font-Buttler-<version>-arm64` only. A raw `gh release upload` is not the upload path. Another version’s `.dmg` or `.zip` left in `release/` stops the command. If `v<version>` is already a published GitHub Release, the command stops and does not replace its files.

   ```bash
   npm run publish:mac
   ```

   If GitHub has no Release for `v<version>`, the command creates a draft with `gh release create v<version> --verify-tag --draft`, uploads the files, checks that the draft lists them, and stops. It does not publish. `/releases/latest` skips drafts, so it does not show a release without a DMG.

   Attached files, and no others:

   - `Font-Buttler-{version}-arm64.dmg` (signed, notarized, and stapled)
   - `Font-Buttler-{version}-arm64.zip` (the stapled app; this is the update-feed file)
   - `Font-Buttler-{version}-arm64.zip.blockmap`
   - `latest-mac.yml` (updater feed; electron-updater is not wired)

   The DMG blockmap is deleted by `scripts/mac-pack.mjs` after electron-builder returns, because stapling changes the DMG bytes. Do not upload a `*.dmg.blockmap`.

7. Download the DMG from the draft Release and open it. After that file is the one you want to ship, publish the Release yourself. This step is not part of `npm run publish:mac`.

   ```bash
   version="$(node -p "require('./package.json').version")"
   gh release edit "v${version}" --draft=false
   ```

   Then confirm `/releases/latest` returns it and that its assets include the DMG.

### Release notes

`npm run publish:mac` writes this text when it creates the Release. People on an ad-hoc build download this version by hand once. Do not turn on auto-install.

```text
This build is signed with Developer ID and notarized by Apple.

If you are using an earlier Font Buttler build, download this version manually once and replace the app. Those builds were ad-hoc signed. The in-app update check compares versions and opens the download in your browser. It does not install the update. Later releases still install the same way: download the file yourself.
```

Tag push still starts [`.github/workflows/release.yml`](../.github/workflows/release.yml). That job runs tests on Ubuntu and `npm run dist` on a macOS runner. The runner has no Developer ID certificate, so `npm run dist` ad-hoc signs and does not notarize. Before `softprops/action-gh-release`, `scripts/assert-notarized-mac-release.mjs` fails that job. GitHub Actions cannot publish an ad-hoc or un-notarized build. The signed files are uploaded as a draft by `npm run publish:mac` on the release Mac. A person publishes that draft only after checking the downloaded DMG.

`npm run release:mac` and `npm run dist` both pass `--publish never`. electron-builder still writes `latest-mac.yml` and the zip blockmap. Do not run `electron-builder --publish always`.

To package on GitHub Actions without publishing, open **Actions → Release → Run workflow** and leave **publish** off. That package is the ad-hoc fallback and is not a release.

## Signing

electron-builder is 26.15.3 (`@electron/notarize` 2.5.0). No upgrade. `mac.notarize: true` turns on the built-in notarize step. That step runs only when one of electron-builder’s credential sets is present. This repo uses the keychain profile:

- `APPLE_KEYCHAIN_PROFILE` (required for notarization)
- `APPLE_KEYCHAIN` (optional; default is the login keychain)

`@electron/notarize` submits the `.app`, waits, and staples the ticket onto the bundle before the dmg and zip are built. The zip is created from that stapled app and is not modified afterwards. The dmg is then Developer ID signed (`dmg.sign: true` only on this notarized path), notarized, and stapled in the `afterAllArtifactBuild` hook. That hook does not submit the zip to notarytool: that would wrap it in another zip and break the blockmap. It also does not rewrite `latest-mac.yml`. electron-builder 26.15.3 writes that file in `publishManager.awaitTasks()`, which runs after the hook, and the sha512 it records for the dmg is the pre-staple hash. After the builder process has returned, `scripts/mac-pack.mjs` rewrites sha512 and size for the stapled dmg and the zip from the bytes on disk, deletes the stale dmg blockmap, and then runs `scripts/assert-notarized-mac-release.mjs`. The top-level sha512 stays the zip.

### Identity

`mac.identity` is `DANIEL QUISEK (A7WWML89LQ)`. That is electron-builder’s format: the `Developer ID Application:` prefix must not be included. The name is pinned so auto-discovery cannot pick an Apple Development certificate on the same Mac.

`hardenedRuntime` is `true`. Entitlements are `build/entitlements.mac.plist` for the app and, via `entitlementsInherit`, for every nested binary electron-builder signs.

### Entitlements

The Developer ID plist has one key: `com.apple.security.cs.allow-jit`. That is what V8 on Apple silicon needs (MAP_JIT, Electron 20+). The same file is `entitlementsInherit`, so the Renderer, GPU, and Utility helpers get it too. `mac.type` stays the default `distribution`. `get-task-allow` is not in the plist, and distribution signing does not inject it.

`allow-unsigned-executable-memory` is not set. `@electron/osx-sign` puts that key only on its plugin-helper default, for Pepper and Widevine. The main app, Renderer, and GPU defaults are `allow-jit` alone. Font Buttler does not load plugins.

`disable-library-validation` is not in the release plist. A Developer ID build re-signs the whole bundle with one team, so library validation should accept Electron’s frameworks, the unpacked `.node` addons, and the bundled Python Mach-O files. The ad-hoc plist does set it, because an ad-hoc signature has no team and hardened runtime would otherwise refuse those libraries. That file is used only when `npm run dist` has no Developer ID certificate and no notary profile.

The publish check rejects `get-task-allow` and `disable-library-validation`. Any new entitlement, `disable-library-validation` included, has to change `scripts/assert-notarized-mac-release.mjs` and its tests in the same pull request. Do not add a key to the plist and leave the check as it is.

### What gets signed

`@electron/osx-sign` walks `Contents` and signs Mach-O files, `.app` bundles, and frameworks, deepest first. Nothing is `signIgnore`’d, and no extra `binaries` list is required, because the extra code already lives inside the bundle:

- Electron frameworks and Helper apps. The packaged API is `utilityProcess.fork` in `electron/main.mjs`, so it runs in the signed Utility helper under the hardened runtime. The font parse worker from the analysis work is a `worker_threads` Worker inside that process (`electron/font-analysis-worker.mjs`). It is JavaScript, not its own Mach-O, and it starts only if that helper is signed and has `allow-jit`.
- `finder-services.node` and `session-fonts.node`, compiled in the `afterPack` hook, which runs before signing, and unpacked via `asarUnpack: "**/*.node"`.
- The bundled CPython under `Contents/Resources/python` (`extraResources`). Scripts are not Mach-O and are not signed; `python3` and its `.so` / `.dylib` files are.

Do **not** set `CSC_IDENTITY_AUTO_DISCOVERY=false`. That skips signing and leaves Electron’s linker-signed binaries inside an unsigned bundle. Gatekeeper then reports the download as damaged until `xattr -cr`. Both pack scripts set `COPYFILE_DISABLE=1`, and the after-pack hook strips copyable xattrs before signing so resource forks are not sealed into the bundle. The after-artifact hook strips xattrs on the zip, then notarizes the DMG. It does not strip the DMG, it does not strip anything after the staple, and it does not write `latest-mac.yml`.

### The DMG and the zip

Both release files carry the notarized, stapled app.

electron-builder notarizes during `sign()`, staples the `.app`, then builds the zip and the dmg. On macOS the zip target uses `zip -r -y`, which keeps the frameworks’ symlinks and the ticket embedded in the app bundle. The zip is not notarized as a zip and is not rewritten, so `xcrun stapler validate` on the app inside the zip passes and the zip blockmap still matches.

The dmg is a separate signed artifact. `dmg.sign` stays unset in `package.json` (ad-hoc and unsigned local packs must not sign a disk image; the identity `"-"` is a dangerous `find-identity` qualifier). The notarized pack writes a config file with `dmg.sign` set to boolean `true`. Passing `-c.dmg.sign=true` does not work: the CLI value stays the string `"true"`, and electron-builder checks `=== true`. After the dmg is signed, the artifact hook submits it to notarytool and staples it. `xcrun stapler validate` then passes on the dmg file itself. `signDmg` returns without throwing when it cannot find an identity, so the hook checks the Developer ID authority and throws before notarizing. A missing or rejected staple fails the build.

### Local and CI builds

On Linux, `npm run dist` without a notary profile skips macOS signing. `npm run release:mac`, and `npm run dist` with `APPLE_KEYCHAIN_PROFILE` set, exit before they pack.

| Command | Certificate missing | Certificate present, no profile | Profile set, or `release:mac` |
| --- | --- | --- | --- |
| `npm run build` | Does not sign or pack | Does not sign or pack | Does not sign or pack |
| `npm run dist` | Ad-hoc sign (`identity: "-"`), hardened runtime, `build/entitlements.mac.adhoc.plist`. Notarization off. Local only. | Developer ID sign, no notarization. Local only. | Developer ID, `forceCodeSigning`, notarize the app, sign and staple the DMG. Missing certificate or a failed sign/notarize stops the build. Not an ad-hoc fallback. Off macOS, the command errors. |
| `npm run release:mac` | Fails. No ad-hoc fallback. | — | Developer ID, profile `font-butler-notary` when unset, notarize, staple the app and the DMG, rewrite `latest-mac.yml` from the files on disk, then the notarization assert. macOS only. |
| `npm run publish:mac` | Refuses to upload | Refuses to upload | Uploads a draft after `stapler validate` passes on the app, the DMG, the app inside the DMG, and the app inside the zip, and `spctl` reports Notarized Developer ID. Leaves the Release as a draft. |

Notarization runs only when `APPLE_KEYCHAIN_PROFILE` is set. `npm run dist` does not set it. Setting the profile, including a leftover one in the environment, selects the notarized path. A half-set `APPLE_ID` / API-key trio is removed from the pack environment so it cannot abort a local build or leak into the pack. The only notary credentials this repo passes through are the keychain profile and optional `APPLE_KEYCHAIN`.

`npm run electron` and `npm run dev` are unsigned dev runs. They do not call electron-builder.

## Auto-update from an ad-hoc build

Since the GitHub Releases check landed, the in-app check compares the running version with `/releases/latest` and links to the download. **Download** and **Open release** open the browser. Nothing is downloaded or installed by the app. `autoInstall` stays `"parked"`. `startParkedAutoInstall()` throws. `electron/main.mjs` does not reference `electron-updater`, `autoDownload`, or `autoInstallOnAppQuit`. This signing change does not turn auto-install on.

`latest-mac.yml` is still produced so a later updater has a feed. Leave that feed unused.

Anyone on an ad-hoc Font Buttler (every GitHub Release built before Developer ID signing, and any `npm run dist` from a machine without the certificate) downloads this notarized version once and replaces the app. The release notes above are the place that says so. After that install, later releases are still a manual download until an explicit Install action exists. Do not enable `electron-updater` in this change. When that work happens, keep `autoDownload` and `autoInstallOnAppQuit` off. A Developer ID designated requirement is stable for team `A7WWML89LQ`; an ad-hoc designated requirement is not, which is why the first signed build cannot be applied by an updater even if one were switched on.

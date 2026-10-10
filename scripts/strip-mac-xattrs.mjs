import { spawnSync } from 'node:child_process'
import path from 'node:path'

export function stripMacXattrs(target) {
  if (process.platform !== 'darwin' || !target) return
  spawnSync('xattr', ['-cr', target], { stdio: 'ignore' })
}

export async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename
  const appBundle = path.join(context.appOutDir, `${appName}.app`)
  let finderSync = null
  if (process.platform === 'darwin') {
    const { compileFinderServicesAddon } = await import('./build-finder-services.mjs')
    const unpacked = path.join(appBundle, 'Contents/Resources/app.asar.unpacked/electron/finder-services.node')
    const compiled = compileFinderServicesAddon({ out: unpacked })
    if (!compiled.ok && !compiled.skipped) {
      console.warn('Finder services addon was not compiled:', compiled.reason)
    }
    const { compileSessionFontsAddon } = await import('./build-session-fonts.mjs')
    const sessionOut = path.join(appBundle, 'Contents/Resources/app.asar.unpacked/electron/session-fonts.node')
    const session = compileSessionFontsAddon({ out: sessionOut })
    if (!session.ok && !session.skipped) {
      console.warn('Session font addon was not compiled:', session.reason)
    }
    const { prepareFinderSyncAppex } = await import('./build-finder-sync.mjs')
    finderSync = prepareFinderSyncAppex({ appBundle, arch: context.arch, env: process.env })
    if (!finderSync.ok) {
      throw new Error(finderSync.reason || 'Finder Sync appex was not built.')
    }
  }
  // Strip resource forks before any signature is sealed. The appex is signed
  // after this, then electron-builder signs the parent app.
  stripMacXattrs(appBundle)
  if (finderSync?.appexPath) {
    const mac = context.packager.platformSpecificBuildOptions ?? context.packager.config?.mac ?? {}
    const { signFinderSyncAppex, verifyFinderSyncAppex } = await import('./build-finder-sync.mjs')
    const signed = signFinderSyncAppex({
      appexPath: finderSync.appexPath,
      identity: mac.identity,
      bundleId: finderSync.bundleId,
      keychain: process.env.APPLE_KEYCHAIN || undefined,
    })
    if (!signed.ok) throw new Error(signed.reason || 'Finder Sync appex was not signed.')
    const verified = verifyFinderSyncAppex({
      appexPath: finderSync.appexPath,
      expectedBundleId: finderSync.bundleId,
      requireDeveloperId: Boolean(mac.identity && mac.identity !== '-'),
    })
    if (!verified.ok) throw new Error(verified.failures.join('\n'))
  }
}

export async function afterAllArtifactBuild(buildResult) {
  const artifacts = buildResult.artifactPaths ?? []
  const profile = (process.env.APPLE_KEYCHAIN_PROFILE || '').trim()
  for (const file of artifacts) {
    // The DMG staple is an xattr. When a notary profile is set the DMG is
    // already Developer ID signed, so clearing xattrs here would strip that
    // signature before notarization. Skip it and staple after this loop.
    if (profile && file.endsWith('.dmg')) continue
    stripMacXattrs(file)
  }
  if (profile) {
    const { stapleSignedDmgs } = await import('./mac-dmg-staple.mjs')
    await stapleSignedDmgs(artifacts, process.env)
  }
  return []
}

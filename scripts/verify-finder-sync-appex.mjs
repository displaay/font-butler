import path from 'node:path'
import { finderSyncBundleId, finderSyncMenuTitle } from '../electron/finder-sync.mjs'
import { readAppTestFeedMarker } from '../electron/app-update-install.mjs'
import { testFeedBuildRequested } from './mac-signing.mjs'
import { finderSyncAppexPath, verifyFinderSyncAppex } from './build-finder-sync.mjs'

/**
 * afterSign hook. electron-builder notarizes during sign, then emits afterSign.
 * This does not re-sign. It fails the pack if the appex is missing, unsigned,
 * or no longer sandboxed with its own bundle ID.
 */
export async function afterSign(context) {
  if (process.platform !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appBundle = path.join(context.appOutDir, `${appName}.app`)
  const mac = context.packager.platformSpecificBuildOptions ?? context.packager.config?.mac ?? {}
  const identity = mac.identity
  const testFeed = testFeedBuildRequested(process.env) || readAppTestFeedMarker(appBundle) === true
  const verified = verifyFinderSyncAppex({
    appexPath: finderSyncAppexPath(appBundle),
    expectedBundleId: finderSyncBundleId(testFeed),
    requireDeveloperId: Boolean(identity && identity !== '-'),
    expectedInstallTitle: finderSyncMenuTitle('install', testFeed),
    expectedInstallAsTitle: finderSyncMenuTitle('install-as', testFeed),
  })
  if (!verified.ok) {
    throw new Error(verified.failures.join('\n'))
  }
  console.log(`Finder Sync appex is present and signed (${finderSyncBundleId(testFeed)}).`)
}

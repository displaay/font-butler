import { spawnSync } from 'node:child_process'
import path from 'node:path'

export function stripMacXattrs(target) {
  if (process.platform !== 'darwin' || !target) return
  spawnSync('xattr', ['-cr', target], { stdio: 'ignore' })
}

export async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename
  const appBundle = path.join(context.appOutDir, `${appName}.app`)
  if (process.platform === 'darwin') {
    const { compileFinderServicesAddon } = await import('./build-finder-services.mjs')
    const unpacked = path.join(appBundle, 'Contents/Resources/app.asar.unpacked/electron/finder-services.node')
    const compiled = compileFinderServicesAddon({ out: unpacked })
    if (!compiled.ok && !compiled.skipped) {
      console.warn('Finder services addon was not compiled:', compiled.reason)
    }
  }
  stripMacXattrs(appBundle)
}

export async function afterAllArtifactBuild(buildResult) {
  for (const file of buildResult.artifactPaths ?? []) {
    stripMacXattrs(file)
  }
  return []
}

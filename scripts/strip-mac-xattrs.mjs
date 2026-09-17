import { spawnSync } from 'node:child_process'
import path from 'node:path'

export function stripMacXattrs(target) {
  if (process.platform !== 'darwin' || !target) return
  spawnSync('xattr', ['-cr', target], { stdio: 'ignore' })
}

export async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename
  stripMacXattrs(path.join(context.appOutDir, `${appName}.app`))
}

export async function afterAllArtifactBuild(buildResult) {
  for (const file of buildResult.artifactPaths ?? []) {
    stripMacXattrs(file)
  }
  return []
}

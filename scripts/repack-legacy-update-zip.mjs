/**
 * 0.3.x clients only accept Font Buttler.app inside the update zip.
 * electron-builder packs Cuttler.app; rewrite the zip entry prefix so the
 * published Font-Buttler-*-arm64.zip still upgrades those installs.
 * The DMG keeps Cuttler.app for new installs. Does not resign or re-staple —
 * renaming the bundle folder does not invalidate the ticket inside Contents.
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const LEGACY_UPDATE_APP_BUNDLE = 'Font Buttler.app'
export const PRODUCT_APP_BUNDLE = 'Cuttler.app'

export function findBundledApp(dir, preferredNames) {
  const names = preferredNames ?? [PRODUCT_APP_BUNDLE, LEGACY_UPDATE_APP_BUNDLE]
  for (const name of names) {
    const direct = path.join(dir, name)
    if (existsSync(direct)) return direct
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const name of names) {
      const nested = path.join(dir, entry.name, name)
      if (existsSync(nested)) return nested
    }
  }
  return null
}

function run(spawnImpl, command, args, options = {}) {
  return spawnImpl(command, args, { encoding: 'utf8', ...options })
}

/**
 * Unpack `zipPath`, ensure the app bundle is named Font Buttler.app, rewrite
 * the zip in place. Returns { rewritten, appName, size }.
 */
export function repackLegacyUpdateZip(zipPath, { spawnImpl = spawnSync } = {}) {
  if (!zipPath || !existsSync(zipPath)) {
    throw new Error('Update zip is missing; cannot rewrite the legacy bundle name.')
  }
  const root = mkdtempSync(path.join(tmpdir(), 'font-butler-legacy-zip-'))
  const unpackDir = path.join(root, 'unpacked')
  const stagingZip = path.join(root, path.basename(zipPath))
  try {
    const unzipped = run(spawnImpl, 'ditto', ['-x', '-k', zipPath, unpackDir])
    if ((unzipped.status ?? 1) !== 0) {
      throw new Error(`Could not unpack ${path.basename(zipPath)} to rewrite the bundle name.`)
    }
    const found = findBundledApp(unpackDir)
    if (!found) {
      throw new Error(`${path.basename(zipPath)} does not contain Cuttler.app or Font Buttler.app.`)
    }
    const parent = path.dirname(found)
    const legacyPath = path.join(parent, LEGACY_UPDATE_APP_BUNDLE)
    if (path.basename(found) !== LEGACY_UPDATE_APP_BUNDLE) {
      if (existsSync(legacyPath)) rmSync(legacyPath, { recursive: true, force: true })
      renameSync(found, legacyPath)
    }
    const zipped = run(
      spawnImpl,
      'ditto',
      ['-c', '-k', '--sequesterRsrc', '--keepParent', LEGACY_UPDATE_APP_BUNDLE, stagingZip],
      { cwd: parent },
    )
    if ((zipped.status ?? 1) !== 0 || !existsSync(stagingZip)) {
      throw new Error(`Could not rebuild ${path.basename(zipPath)} with Font Buttler.app.`)
    }
    const previous = `${zipPath}.pre-legacy`
    renameSync(zipPath, previous)
    try {
      cpSync(stagingZip, zipPath)
      rmSync(previous, { force: true })
    } catch (error) {
      renameSync(previous, zipPath)
      throw error
    }
    return {
      rewritten: true,
      appName: LEGACY_UPDATE_APP_BUNDLE,
      size: statSync(zipPath).size,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const zipPath = process.argv[2]
  const result = repackLegacyUpdateZip(zipPath)
  console.log(`Rewrote ${path.basename(zipPath)} to contain ${result.appName} (${result.size} bytes).`)
}

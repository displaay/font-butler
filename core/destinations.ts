import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isFullyUnderAnyRoot } from './containment.ts'
import { instancesOverlap } from './formats.ts'
import { tryFingerprintFile } from './fingerprint.ts'
import { extensionForFormat } from './install.ts'
import { isFontFile, parseFontFile } from './parse.ts'
import type { AppPaths } from './paths.ts'
import type {
  CatalogEntry,
  DestinationCapability,
  DestinationId,
  DestinationInvestigationRow,
  FontFaceInfo,
  InstallationCopy,
} from './types.ts'

export const ADOBE_SHARED_FONTS = '/Library/Application Support/Adobe/Fonts'

export const DESTINATION_IDS: DestinationId[] = ['macos', 'adobe-shared']

export function isDestinationId(value: unknown): value is DestinationId {
  return value === 'macos' || value === 'adobe-shared'
}

export function destinationLabel(id: DestinationId): string {
  return id === 'adobe-shared' ? 'Adobe testing folder' : 'This Mac'
}

export function adobeFontsDir(paths: AppPaths): string {
  if (paths.adobeFontsDir) return path.resolve(paths.adobeFontsDir)
  return path.resolve(ADOBE_SHARED_FONTS)
}

export function destinationDir(paths: AppPaths, id: DestinationId): string {
  return id === 'adobe-shared' ? adobeFontsDir(paths) : path.resolve(paths.installDir)
}

function dirState(dir: string): { exists: boolean; writable: boolean; reason?: string; remedy?: string } {
  try {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      fs.accessSync(dir, fs.constants.W_OK)
      return { exists: true, writable: true }
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'EACCES' || code === 'EPERM') {
      return {
        exists: true,
        writable: false,
        reason: 'Write permission was denied.',
        remedy:
          'Give your user Read & Write on that folder in Finder Get Info. Font Buttler will not change permissions.',
      }
    }
  }
  const parent = path.dirname(dir)
  const parentExists = fs.existsSync(parent)
  return {
    exists: false,
    writable: false,
    reason: parentExists ? 'The Fonts folder is not present.' : 'The destination is not available.',
    remedy: parentExists
      ? `Create ${dir} with Read & Write access. Font Buttler will not create or chmod a system Adobe folder.`
      : 'The Adobe Application Support folder was not found on this Mac.',
  }
}

export function inspectDestination(paths: AppPaths, id: DestinationId): DestinationCapability {
  const dest = destinationDir(paths, id)
  if (id === 'macos') {
    try {
      fs.mkdirSync(dest, { recursive: true })
      fs.accessSync(dest, fs.constants.W_OK)
      return {
        id,
        label: destinationLabel(id),
        path: dest,
        exists: true,
        writable: true,
        supported: true,
        activationVerified: true,
      }
    } catch {
      return {
        id,
        label: destinationLabel(id),
        path: dest,
        exists: fs.existsSync(dest),
        writable: false,
        supported: false,
        activationVerified: false,
        reason: 'The macOS fonts folder is not writable.',
        remedy: 'Check that Font Buttler can write to the user Fonts folder.',
      }
    }
  }
  const isolated = dest !== path.resolve(ADOBE_SHARED_FONTS)
  if (isolated) {
    fs.mkdirSync(dest, { recursive: true })
  }
  const state = dirState(dest)
  return {
    id,
    label: destinationLabel(id),
    path: dest,
    exists: state.exists,
    writable: state.writable,
    supported: state.exists && state.writable,
    activationVerified: false,
    reason: state.writable
      ? 'File placement is supported. Presence in an Adobe app is not verified.'
      : state.reason,
    remedy: state.writable ? undefined : state.remedy,
  }
}

export function listDestinations(paths: AppPaths): DestinationCapability[] {
  return DESTINATION_IDS.map((id) => inspectDestination(paths, id))
}

export function assertDestinationReady(paths: AppPaths, id: DestinationId): DestinationCapability {
  const capability = inspectDestination(paths, id)
  if (!capability.supported) {
    throw new Error(
      capability.remedy || capability.reason || `${destinationLabel(id)} is not available.`,
    )
  }
  return capability
}

export function adobeInvestigation(paths: AppPaths): DestinationInvestigationRow[] {
  const adobe = inspectDestination(paths, 'adobe-shared')
  const host = `${os.platform()} ${os.release()}`
  return [
    {
      destination: 'Adobe shared Fonts folder',
      path: ADOBE_SHARED_FONTS,
      macos: host,
      applications: 'InDesign 2025 20.4.1.4; InDesign 2026 21.0.0.192; Photoshop not installed; Illustrator not installed',
      formats: 'TTF/OTF file placement; variable-font app refresh not verified',
      refreshWhileOpen: 'Not tested. Glyphs (2022) reports immediate refresh; this run does not claim that.',
      permissions: adobe.writable ? 'Writable in this environment' : adobe.reason || 'Not writable',
      systemConflict: 'Same-face copies in the folder or in macOS Fonts can confuse Adobe menus. Unmanaged files are left in place.',
      cleanup: 'Only Font Buttler-managed files are removed. The destination is never emptied.',
      conclusion: adobe.supported
        ? 'Supported for managed file placement only. App activation is verification-unavailable.'
        : 'Unavailable until the Glyphs-documented folder exists and is writable. No speculative writer is enabled.',
    },
    {
      destination: 'InDesign 2025 app Fonts folder',
      path: '/Applications/Adobe InDesign 2025/Fonts',
      macos: host,
      applications: 'InDesign 2025 20.4.1.4',
      formats: 'Not exercised',
      refreshWhileOpen: 'Not tested',
      permissions: 'Folder exists; write denied for the current user',
      systemConflict: 'App-specific and shared Adobe folders can both be loaded. Glyphs recommends using only one.',
      cleanup: 'Not implemented; destination stays unavailable',
      conclusion: 'Unsupported. One successful InDesign install does not enable this writer.',
    },
    {
      destination: 'InDesign 2026 app Fonts folder',
      path: '/Applications/Adobe InDesign 2026/Fonts',
      macos: host,
      applications: 'InDesign 2026 21.0.0.192',
      formats: 'Not exercised',
      refreshWhileOpen: 'Not tested',
      permissions: 'Folder exists; write denied for the current user',
      systemConflict: 'Same as InDesign 2025 app folder',
      cleanup: 'Not implemented; destination stays unavailable',
      conclusion: 'Unsupported. Not generalized from the shared-folder adapter.',
    },
  ]
}

export function copiesOf(entry: CatalogEntry): InstallationCopy[] {
  return [...(entry.installations ?? [])]
}

export function copyAt(entry: CatalogEntry, id: DestinationId): InstallationCopy | undefined {
  return copiesOf(entry).find((item) => item.destinationId === id)
}

export function upsertCopy(entry: CatalogEntry, copy: InstallationCopy): void {
  const next = copiesOf(entry).filter((item) => item.destinationId !== copy.destinationId)
  next.push(copy)
  entry.installations = next
  entry.destinationId = copy.destinationId
  if (copy.destinationId === 'macos') {
    entry.installedPath = copy.path
  }
}

export function dropCopy(entry: CatalogEntry, id: DestinationId): InstallationCopy | undefined {
  const existing = copyAt(entry, id)
  entry.installations = copiesOf(entry).filter((item) => item.destinationId !== id)
  if (id === 'macos') {
    entry.installedPath = undefined
  }
  if (entry.destinationId === id) {
    entry.destinationId = entry.installations[0]?.destinationId
  }
  return existing
}

export function syncLegacyInstallations(entry: CatalogEntry): void {
  if (entry.installedPath && !copyAt(entry, 'macos')) {
    upsertCopy(entry, {
      destinationId: 'macos',
      path: entry.installedPath,
      fingerprint: entry.installedFingerprint,
      verification: fs.existsSync(entry.installedPath) ? 'file-present' : 'unavailable',
    })
  }
  for (const copy of copiesOf(entry)) {
    const present = Boolean(copy.path && fs.existsSync(copy.path))
    copy.verification = present ? 'file-present' : 'unavailable'
  }
}

export function hasManagedCopy(entry: CatalogEntry, id?: DestinationId): boolean {
  if (id) {
    const copy = copyAt(entry, id)
    return Boolean(copy?.path && fs.existsSync(copy.path))
  }
  return copiesOf(entry).some((copy) => copy.path && fs.existsSync(copy.path))
}

export function destinationSummary(entry: CatalogEntry): string | undefined {
  const present = copiesOf(entry).filter((copy) => copy.verification === 'file-present' || (copy.path && fs.existsSync(copy.path)))
  if (present.length === 0) return undefined
  const macos = present.some((copy) => copy.destinationId === 'macos')
  const adobe = present.some((copy) => copy.destinationId === 'adobe-shared')
  if (macos && adobe) return 'This Mac and Adobe testing folder'
  if (adobe) return 'Adobe testing folder'
  return undefined
}

function listDestinationFonts(dir: string, depth = 0): string[] {
  if (depth > 4 || !fs.existsSync(dir)) return []
  const found: string[] = []
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    try {
      const stat = fs.lstatSync(full)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        found.push(...listDestinationFonts(full, depth + 1))
      } else if (stat.isFile() && isFontFile(full)) {
        found.push(full)
      }
    } catch {
      // Skip unreadable neighbors.
    }
  }
  return found
}

export function findUnmanagedConflicts(
  paths: AppPaths,
  id: DestinationId,
  faces: FontFaceInfo[],
  managedPaths: string[] = [],
): Array<{ path: string; reason: string }> {
  const dir = destinationDir(paths, id)
  if (!fs.existsSync(dir)) return []
  const managed = new Set(managedPaths.map((item) => path.resolve(item)))
  const incoming = { faces }
  const conflicts: Array<{ path: string; reason: string }> = []
  for (const filePath of listDestinationFonts(dir)) {
    const resolved = path.resolve(filePath)
    if (managed.has(resolved)) continue
    try {
      const parsed = parseFontFile(resolved)
      if (instancesOverlap(incoming, parsed)) {
        conflicts.push({
          path: resolved,
          reason: 'A font with the same face is already in this destination and is not managed by Font Buttler.',
        })
      }
    } catch {
      // Unreadable neighbors are left untouched.
    }
  }
  return conflicts
}

function containedDestinationFile(paths: AppPaths, id: DestinationId, dest: string): string {
  const root = destinationDir(paths, id)
  const resolved = path.resolve(dest)
  if (!isFullyUnderAnyRoot(resolved, [root])) {
    throw new Error('That destination path is not valid.')
  }
  return resolved
}

export function plannedManagedPath(
  paths: AppPaths,
  id: DestinationId,
  fromPath: string,
  format: string,
): string {
  const dir = destinationDir(paths, id)
  const ext = extensionForFormat(format, fromPath)
  const stem = path.basename(fromPath, path.extname(fromPath))
  const dest = path.join(dir, `${stem}${ext}`)
  if (!fs.existsSync(dest)) return containedDestinationFile(paths, id, dest)
  const hash = crypto.createHash('sha1').update(path.resolve(fromPath)).digest('hex').slice(0, 8)
  return containedDestinationFile(paths, id, path.join(dir, `${stem}-${hash}${ext}`))
}

export function writeManagedCopy(options: {
  paths: AppPaths
  destinationId: DestinationId
  stagedPath: string
  dest: string
  rollbackDir: string
}): string {
  const { paths, destinationId, stagedPath, rollbackDir } = options
  assertDestinationReady(paths, destinationId)
  const dest = containedDestinationFile(paths, destinationId, options.dest)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.mkdirSync(rollbackDir, { recursive: true })
  let rollback: string | undefined
  if (fs.existsSync(dest)) {
    rollback = path.join(rollbackDir, `${crypto.randomUUID()}${path.extname(dest) || '.ttf'}`)
    fs.copyFileSync(dest, rollback)
  }
  try {
    fs.copyFileSync(stagedPath, dest)
    const expected = tryFingerprintFile(stagedPath)
    const actual = tryFingerprintFile(dest)
    if (!actual || (expected && actual !== expected)) {
      throw new Error('The Adobe testing copy did not match the reviewed file.')
    }
    if (rollback) {
      fs.rmSync(rollback, { force: true })
    }
    return dest
  } catch (error) {
    if (rollback && fs.existsSync(rollback)) {
      fs.copyFileSync(rollback, dest)
      fs.rmSync(rollback, { force: true })
    } else if (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(stagedPath)) {
      fs.rmSync(dest, { force: true })
    }
    throw error
  }
}

export function removeManagedCopy(paths: AppPaths, id: DestinationId, filePath: string | undefined): void {
  if (!filePath) return
  const dest = containedDestinationFile(paths, id, filePath)
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { force: true })
  }
}

export function verifyManagedCopy(
  paths: AppPaths,
  id: DestinationId,
  filePath: string | undefined,
  expected?: string,
): InstallationCopy['verification'] {
  if (!filePath) return 'unavailable'
  try {
    const dest = containedDestinationFile(paths, id, filePath)
    if (!fs.existsSync(dest)) return 'unavailable'
    if (expected) {
      const actual = tryFingerprintFile(dest)
      if (actual !== expected) return 'unavailable'
    }
    return 'file-present'
  } catch {
    return 'unavailable'
  }
}

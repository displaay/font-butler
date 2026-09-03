import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { findById, findBySourcePath, loadCatalog, resolveStatusWhenSourceFound, runCatalogTask, saveCatalog, upsertEntry } from './catalog.ts'
import { getOrCreateApiToken } from './auth.ts'
import { clearFontCaches, registerFont, unregisterFont } from './caches.ts'
import { MAX_UPLOAD_BYTES } from './constants.ts'
import { emitEvent } from './events.ts'
import { isFontFile, mimeForFont, parseFontFile, readFileStat } from './parse.ts'
import { ensureDirs, getPaths, type AppPaths } from './paths.ts'
import { postscriptPreview, renameFamilyCopy } from './rename.ts'
import { revealInFileManager } from './reveal.ts'
import { allowedFontPath, scanSystemFonts } from './system.ts'
import type { CatalogEntry, Notice, SystemFace } from './types.ts'
import { syncWatchers } from './watch.ts'

function now(): number {
  return Date.now()
}

function newId(): string {
  return crypto.randomUUID()
}

function displayFamily(entry: CatalogEntry): string {
  return entry.customFamilyName || entry.faces[0]?.familyName || 'Unknown'
}

function uniqueInstallName(entry: CatalogEntry, sourcePath: string): string {
  const family = displayFamily(entry).replace(/[^\w.-]+/g, '_')
  const style = (entry.faces[0]?.styleName || 'Regular').replace(/[^\w.-]+/g, '_')
  const hash = crypto
    .createHash('sha1')
    .update(`${sourcePath}:${entry.sourceMtimeMs}:${entry.customFamilyName ?? ''}:${now()}`)
    .digest('hex')
    .slice(0, 8)
  const ext = path.extname(sourcePath) || '.ttf'
  return `${family}-${style}-${hash}${ext}`
}

function emitCatalog(paths: AppPaths): CatalogEntry[] {
  const catalog = loadCatalog(paths)
  emitEvent({ type: 'catalog', entries: catalog.entries })
  return catalog.entries
}

function emitNotice(notice: Notice): void {
  emitEvent({ type: 'notice', notice })
}

function touchEntry(entry: CatalogEntry): void {
  entry.updatedAt = now()
}

async function removeInstalledCopy(entry: CatalogEntry): Promise<void> {
  if (entry.installedPath) {
    await unregisterFont(entry.installedPath)
    if (fs.existsSync(entry.installedPath)) {
      fs.rmSync(entry.installedPath, { force: true })
    }
  }
  entry.installedPath = undefined
}

function copyIntoInstallDir(
  paths: AppPaths,
  entry: CatalogEntry,
  fromPath: string,
): string {
  fs.mkdirSync(paths.installDir, { recursive: true })
  const dest = path.join(paths.installDir, uniqueInstallName(entry, fromPath))
  fs.copyFileSync(fromPath, dest)
  return dest
}

export class FontcaseService {
  readonly paths: AppPaths

  constructor(paths: AppPaths = getPaths()) {
    this.paths = paths
    ensureDirs(paths)
  }

  async init(): Promise<void> {
    ensureDirs(this.paths)
    await this.seedIfEmpty()
    await this.refreshSourceStatuses()
    await syncWatchers(this.paths)
  }

  listCatalog(): CatalogEntry[] {
    return loadCatalog(this.paths).entries
  }

  getApiToken(): string {
    return getOrCreateApiToken(this.paths.apiTokenPath)
  }

  listSystem(): SystemFace[] {
    const faces = scanSystemFonts(this.paths)
    emitEvent({ type: 'system', faces })
    return faces
  }

  async importPaths(filePaths: string[]): Promise<{ entries: CatalogEntry[]; errors: string[] }> {
    return runCatalogTask(async () => {
      const errors: string[] = []
      const imported: CatalogEntry[] = []
      for (const filePath of filePaths) {
        try {
          imported.push(this.importOneUnlocked(path.resolve(filePath)))
        } catch (error) {
          errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return { entries: imported, errors }
    })
  }

  async importUploads(
    files: { filename: string; data: Buffer }[],
  ): Promise<{ entries: CatalogEntry[]; errors: string[] }> {
    return runCatalogTask(async () => {
      fs.mkdirSync(this.paths.uploadsDir, { recursive: true })
      const saved: string[] = []
      const errors: string[] = []
      for (const file of files) {
        if (file.data.length > MAX_UPLOAD_BYTES) {
          errors.push(`${file.filename}: file exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`)
          continue
        }
        const safe = path.basename(file.filename).replace(/[^\w.-]+/g, '_')
        const dest = path.join(this.paths.uploadsDir, `${Date.now()}-${safe}`)
        fs.writeFileSync(dest, file.data)
        saved.push(dest)
      }
      const imported: CatalogEntry[] = []
      for (const filePath of saved) {
        try {
          imported.push(this.importOneUnlocked(filePath))
        } catch (error) {
          errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return { entries: imported, errors }
    })
  }

  async openWith(filePath: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = this.importOneUnlocked(path.resolve(filePath))
      await syncWatchers(this.paths)
      if (entry.status === 'installed') {
        emitCatalog(this.paths)
        emitNotice({
          kind: 'info',
          message: `${displayFamily(entry)} is already installed.`,
          entryId: entry.id,
        })
        return entry
      }
      if (entry.status === 'outdated' || entry.status === 'deactivated') {
        return this.reinstallEntry(entry.id)
      }
      const installed = await this.installEntry(entry.id)
      emitNotice({
        kind: 'installed',
        message: `Installed ${displayFamily(installed)}`,
        entryId: installed.id,
      })
      return installed
    })
  }

  async install(id: string, familyName?: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.installEntry(id, familyName)
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entry
    })
  }

  async installMany(ids: string[], familyName?: string): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        entries.push(await this.installEntry(id, familyName))
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      return entries
    })
  }

  async uninstall(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.uninstallEntry(id)
      emitCatalog(this.paths)
      return entry
    })
  }

  async uninstallMany(ids: string[]): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        entries.push(await this.uninstallEntry(id))
      }
      emitCatalog(this.paths)
      return entries
    })
  }

  async deactivate(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.deactivateEntry(id)
      emitCatalog(this.paths)
      return entry
    })
  }

  async deactivateMany(ids: string[]): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        entries.push(await this.deactivateEntry(id))
      }
      emitCatalog(this.paths)
      return entries
    })
  }

  async activate(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.activateEntry(id)
      emitCatalog(this.paths)
      return entry
    })
  }

  async activateMany(ids: string[]): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        entries.push(await this.activateEntry(id))
      }
      emitCatalog(this.paths)
      return entries
    })
  }

  async reinstall(id: string): Promise<CatalogEntry> {
    return runCatalogTask(async () => {
      const entry = await this.reinstallEntry(id)
      emitCatalog(this.paths)
      return entry
    })
  }

  async reinstallMany(ids: string[]): Promise<CatalogEntry[]> {
    return runCatalogTask(async () => {
      await clearFontCaches()
      const entries: CatalogEntry[] = []
      for (const id of ids) {
        const catalog = loadCatalog(this.paths)
        const entry = findById(catalog, id)
        if (!entry) {
          throw new Error('Font is not in the library.')
        }
        await removeInstalledCopy(entry)
        entries.push(await this.installEntry(id, entry.customFamilyName))
      }
      await syncWatchers(this.paths)
      emitCatalog(this.paths)
      const first = entries[0]
      if (first) {
        emitNotice({
          kind: 'reinstalled',
          message: `Reinstalled ${entries.length} ${entries.length === 1 ? 'font' : 'fonts'}`,
          entryId: first.id,
        })
      }
      return entries
    })
  }

  async uninstallSystem(filePath: string): Promise<void> {
    return runCatalogTask(async () => {
      const resolved = path.resolve(filePath)
      if (!allowedFontPath(resolved, this.paths)) {
        throw new Error('That font is outside the font folders Fontcase can manage.')
      }
      const catalog = loadCatalog(this.paths)
      const managed = catalog.entries.find(
        (entry) =>
          entry.installedPath && path.resolve(entry.installedPath) === resolved,
      )
      if (managed) {
        await this.uninstallEntry(managed.id)
        emitCatalog(this.paths)
        return
      }
      if (!fs.existsSync(resolved)) {
        throw new Error('Font file is already gone.')
      }
      if (isProtectedSystem(resolved, this.paths)) {
        throw new Error('Protected system fonts cannot be removed.')
      }
      try {
        fs.accessSync(resolved, fs.constants.W_OK)
      } catch {
        throw new Error('Protected system fonts cannot be removed.')
      }
      await unregisterFont(resolved)
      fs.rmSync(resolved, { force: true })
      emitEvent({ type: 'system', faces: scanSystemFonts(this.paths) })
    })
  }

  async deactivateSystem(filePath: string): Promise<void> {
    return runCatalogTask(async () => {
      const resolved = path.resolve(filePath)
      if (!allowedFontPath(resolved, this.paths)) {
        throw new Error('That font is outside the font folders Fontcase can manage.')
      }
      const catalog = loadCatalog(this.paths)
      const managed = catalog.entries.find(
        (entry) =>
          entry.installedPath && path.resolve(entry.installedPath) === resolved,
      )
      if (managed) {
        await this.deactivateEntry(managed.id)
        emitCatalog(this.paths)
        return
      }
      if (!fs.existsSync(resolved)) {
        throw new Error('Font file is already gone.')
      }
      if (isProtectedSystem(resolved, this.paths)) {
        throw new Error('Protected system fonts cannot be deactivated.')
      }
      try {
        fs.accessSync(resolved, fs.constants.W_OK)
      } catch {
        throw new Error('Protected system fonts cannot be deactivated.')
      }
      await unregisterFont(resolved)
      fs.mkdirSync(this.paths.disabledDir, { recursive: true })
      const dest = path.join(this.paths.disabledDir, path.basename(resolved))
      fs.renameSync(resolved, dest)
      emitEvent({ type: 'system', faces: scanSystemFonts(this.paths) })
    })
  }

  async reveal(id: string, which: 'source' | 'installed'): Promise<string> {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const target =
      which === 'installed'
        ? entry.installedPath || entry.disabledPath
        : entry.sourcePath
    if (!target) {
      throw new Error('There is no file to show.')
    }
    await revealInFileManager(target)
    return target
  }

  async revealPath(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath)
    if (!allowedFontPath(resolved, this.paths)) {
      throw new Error('That path is outside the font folders Fontcase can reveal.')
    }
    if (!fs.existsSync(resolved)) {
      throw new Error('That file is no longer on disk.')
    }
    await revealInFileManager(resolved)
    return resolved
  }

  fontBytesForEntry(id: string): { buffer: Buffer; mime: string; filename: string } {
    const entry = findById(loadCatalog(this.paths), id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    const filePath = [entry.installedPath, entry.disabledPath, entry.sourcePath].find(
      (candidate) => candidate && fs.existsSync(candidate),
    )
    if (!filePath) {
      throw new Error('No font file is available to preview.')
    }
    return {
      buffer: fs.readFileSync(filePath),
      mime: mimeForFont(filePath),
      filename: path.basename(filePath),
    }
  }

  fontBytesForPath(filePath: string): { buffer: Buffer; mime: string; filename: string } {
    const resolved = path.resolve(filePath)
    if (!allowedFontPath(resolved, this.paths)) {
      throw new Error('That font path is not readable.')
    }
    if (!fs.existsSync(resolved)) {
      throw new Error('Font file is missing.')
    }
    return {
      buffer: fs.readFileSync(resolved),
      mime: mimeForFont(resolved),
      filename: path.basename(resolved),
    }
  }

  namePreview(id: string, familyName: string): { fullName: string; postscriptName: string } {
    const entry = findById(loadCatalog(this.paths), id)
    const style = entry?.faces[0]?.styleName || 'Regular'
    return {
      fullName: `${familyName} ${style}`.trim(),
      postscriptName: postscriptPreview(familyName, style),
    }
  }

  private async installEntry(id: string, familyName?: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (!fs.existsSync(entry.sourcePath)) {
      entry.status = 'source-missing'
      saveCatalog(this.paths, catalog)
      throw new Error('The source file is missing.')
    }
    let sourceForInstall = entry.sourcePath
    let temp: string | undefined
    if (familyName && familyName.trim()) {
      entry.customFamilyName = familyName.trim()
      temp = await renameFamilyCopy(entry.sourcePath, entry.customFamilyName)
      sourceForInstall = temp
      try {
        entry.faces = parseFontFile(temp).faces
      } catch {
        // Keep original parsed faces if the renamed copy cannot be re-parsed.
      }
    }
    await removeInstalledCopy(entry)
    const dest = copyIntoInstallDir(this.paths, entry, sourceForInstall)
    if (temp && fs.existsSync(temp)) {
      fs.rmSync(temp, { force: true })
    }
    await registerFont(dest)
    const stat = readFileStat(entry.sourcePath)
    entry.installedPath = dest
    entry.disabledPath = undefined
    entry.sourceMtimeMs = stat.mtimeMs
    entry.sourceSize = stat.size
    entry.installedSnapshotMtimeMs = stat.mtimeMs
    entry.installedSnapshotSize = stat.size
    entry.status = 'installed'
    touchEntry(entry)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private async uninstallEntry(id: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    await removeInstalledCopy(entry)
    if (entry.disabledPath && fs.existsSync(entry.disabledPath)) {
      fs.rmSync(entry.disabledPath, { force: true })
    }
    entry.disabledPath = undefined
    entry.status = fs.existsSync(entry.sourcePath) ? 'uninstalled' : 'source-missing'
    touchEntry(entry)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private async deactivateEntry(id: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (!entry.installedPath || !fs.existsSync(entry.installedPath)) {
      throw new Error('This font is not installed.')
    }
    await unregisterFont(entry.installedPath)
    fs.mkdirSync(this.paths.disabledDir, { recursive: true })
    const dest = path.join(this.paths.disabledDir, path.basename(entry.installedPath))
    fs.renameSync(entry.installedPath, dest)
    entry.installedPath = undefined
    entry.disabledPath = dest
    entry.status = 'deactivated'
    touchEntry(entry)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private async activateEntry(id: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    if (!entry.disabledPath || !fs.existsSync(entry.disabledPath)) {
      return this.installEntry(id)
    }
    fs.mkdirSync(this.paths.installDir, { recursive: true })
    const dest = path.join(this.paths.installDir, path.basename(entry.disabledPath))
    fs.renameSync(entry.disabledPath, dest)
    await registerFont(dest)
    entry.installedPath = dest
    entry.disabledPath = undefined
    entry.status = 'installed'
    touchEntry(entry)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private async reinstallEntry(id: string): Promise<CatalogEntry> {
    const catalog = loadCatalog(this.paths)
    const entry = findById(catalog, id)
    if (!entry) {
      throw new Error('Font is not in the library.')
    }
    await removeInstalledCopy(entry)
    await clearFontCaches()
    const updated = await this.installEntry(id, entry.customFamilyName)
    emitNotice({
      kind: 'reinstalled',
      message: `Reinstalled ${displayFamily(updated)}`,
      entryId: updated.id,
    })
    return updated
  }

  private importOneUnlocked(filePath: string): CatalogEntry {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error('Not a file.')
    }
    if (!isFontFile(filePath)) {
      throw new Error('Not a font file.')
    }
    const parsed = parseFontFile(filePath)
    if (parsed.faces.length === 0) {
      throw new Error('Could not read any faces in that font.')
    }
    const catalog = loadCatalog(this.paths)
    const existing = findBySourcePath(catalog, filePath)
    const stat = readFileStat(filePath)
    if (existing) {
      existing.faces = parsed.faces
      existing.format = parsed.format
      existing.sourceMtimeMs = stat.mtimeMs
      existing.sourceSize = stat.size
      if (existing.status === 'source-missing') {
        existing.status = resolveStatusWhenSourceFound(existing)
      }
      if (
        existing.status === 'installed' &&
        (stat.mtimeMs !== existing.installedSnapshotMtimeMs ||
          stat.size !== existing.installedSnapshotSize)
      ) {
        existing.status = 'outdated'
      }
      touchEntry(existing)
      saveCatalog(this.paths, catalog)
      return existing
    }
    const entry: CatalogEntry = {
      id: newId(),
      sourcePath: filePath,
      sourceMtimeMs: stat.mtimeMs,
      sourceSize: stat.size,
      status: 'uninstalled',
      faces: parsed.faces,
      format: parsed.format,
      addedAt: now(),
      updatedAt: now(),
    }
    upsertEntry(catalog, entry)
    saveCatalog(this.paths, catalog)
    return entry
  }

  private async refreshSourceStatuses(): Promise<void> {
    const catalog = loadCatalog(this.paths)
    let changed = false
    for (const entry of catalog.entries) {
      if (!fs.existsSync(entry.sourcePath)) {
        if (entry.status !== 'source-missing') {
          entry.status = 'source-missing'
          touchEntry(entry)
          changed = true
        }
        continue
      }
      const stat = readFileStat(entry.sourcePath)
      entry.sourceMtimeMs = stat.mtimeMs
      entry.sourceSize = stat.size
      if (
        entry.status === 'installed' &&
        (stat.mtimeMs !== entry.installedSnapshotMtimeMs ||
          stat.size !== entry.installedSnapshotSize)
      ) {
        entry.status = 'outdated'
        touchEntry(entry)
        changed = true
      }
    }
    if (changed) {
      saveCatalog(this.paths, catalog)
    }
  }

  private async seedIfEmpty(): Promise<void> {
    const catalog = loadCatalog(this.paths)
    if (catalog.entries.length > 0) {
      return
    }
    const seedDir = this.paths.seedDir
    if (!fs.existsSync(seedDir)) {
      return
    }
    const files = fs
      .readdirSync(seedDir)
      .map((name) => path.join(seedDir, name))
      .filter((filePath) => fs.statSync(filePath).isFile() && isFontFile(filePath))
    if (files.length === 0) {
      return
    }
    const imported = await this.importPaths(files)
    const variable = imported.entries.find((entry) =>
      entry.faces.some((face) => face.isVariable),
    )
    const installTarget = variable ?? imported.entries[0]
    if (installTarget) {
      await this.install(installTarget.id)
    }
    const leftover = imported.entries.find((entry) => entry.id !== installTarget?.id)
    if (leftover) {
      const latest = loadCatalog(this.paths)
      const row = findById(latest, leftover.id)
      if (row) {
        row.status = 'uninstalled'
        saveCatalog(this.paths, latest)
      }
    }
    const outdatedDemo = loadCatalog(this.paths).entries.find(
      (entry) => entry.status === 'installed',
    )
    if (
      outdatedDemo &&
      (process.platform !== 'darwin' || process.env.FONTCASE_DEMO === '1')
    ) {
      const latest = loadCatalog(this.paths)
      const row = findById(latest, outdatedDemo.id)
      if (row) {
        row.installedSnapshotMtimeMs = (row.sourceMtimeMs ?? 1) - 1
        row.status = 'outdated'
        saveCatalog(this.paths, latest)
      }
    }
  }
}

function isProtectedSystem(filePath: string, paths: AppPaths): boolean {
  const resolved = path.resolve(filePath)
  return (
    resolved.startsWith(path.resolve(paths.systemFontsDir)) ||
    resolved.startsWith('/usr/share/fonts')
  )
}

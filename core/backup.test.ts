import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  BACKUP_LICENSE_WARNING,
  createBackup,
  planRestore,
  previewBackup,
  readZipFile,
  redactSecrets,
  restoreBackup,
  writeZipFile,
} from './backup.ts'
import { faceIdentityKey, loadCatalog, saveCatalog } from './catalog.ts'
import { fingerprintFile } from './fingerprint.ts'
import { createWatchFolder } from './folders.ts'
import { loadProjects, saveProjects } from './projects.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { tempPaths, writeTestFont } from './test-util.ts'
import type { AppPaths } from './paths.ts'
import type { CatalogEntry } from './types.ts'

function entryFor(id: string, sourcePath: string, family: string, psName: string, extra: Partial<CatalogEntry> = {}): CatalogEntry {
  const stat = fs.statSync(sourcePath)
  return {
    id,
    sourcePath,
    sourceMtimeMs: stat.mtimeMs,
    sourceSize: stat.size,
    sourceFingerprint: fingerprintFile(sourcePath),
    status: 'uninstalled',
    faces: [{ familyName: family, styleName: 'Regular', fullName: `${family} Regular`, postscriptName: psName, isVariable: false, instanceCount: 1, instanceNames: [], weight: 400, italic: false }],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

function makeLibrary(prefix: string) {
  const paths = tempPaths(prefix)
  const srcDir = path.join(paths.dataRoot, 'library-src')
  fs.mkdirSync(srcDir, { recursive: true })
  const alphaPath = path.join(srcDir, 'Alpha.ttf')
  const betaPath = path.join(srcDir, 'Beta.ttf')
  writeTestFont(alphaPath, 'Alpha', 'Alpha-Regular')
  writeTestFont(betaPath, 'Beta', 'Beta-Regular')
  const watchRoot = path.join(paths.dataRoot, 'watched')
  fs.mkdirSync(watchRoot, { recursive: true })

  const alpha = entryFor('alpha-id', alphaPath, 'Alpha', 'Alpha-Regular')
  const beta = entryFor('beta-id', betaPath, 'Beta', 'Beta-Regular', { status: 'deactivated', disabledPath: betaPath })
  saveCatalog(paths, {
    version: 1,
    entries: [alpha, beta],
    tags: [
      { id: 'licensed', name: 'Licensed', color: '#1f8a4c', seed: 'licensed' },
      { id: 'custom-1', name: 'Client work', color: '#7c5cbf' },
    ],
    familyTags: [{ familyKey: 'Alpha', tagIds: ['custom-1'] }],
  })
  saveProjects(paths, [
    { id: 'proj-1', name: 'Brand', members: [{ assetId: 'alpha-id' }, { assetId: 'beta-id', pinFingerprint: beta.sourceFingerprint }], desiredActive: false, unresolved: [{ postscriptName: 'Missing-Regular', familyName: 'Missing', styleName: 'Regular', sourceFile: 'doc.pdf' }] },
    { id: 'smart-1', name: 'Installed smart', kind: 'smart', members: [], desiredActive: false, rules: { match: 'all', rules: [{ id: 'r1', field: 'status', operator: 'is', value: 'installed' }] } },
  ])
  const settings = loadSettings(paths)
  settings.folders = [createWatchFolder(watchRoot, { id: 'watch-1' })]
  settings.watchFolders = [watchRoot]
  settings.savedFilters = [{ id: 'filter-1', name: 'Favourites', query: 'Alpha', libraryFilters: ['installed'], watchFolder: null, createdAt: 1 }]
  settings.theme = 'dark'
  saveSettings(paths, settings)
  // Secret-bearing files/fields that must never enter the archive.
  fs.writeFileSync(path.join(paths.dataRoot, 'api-token'), 'SUPER-SECRET-API-TOKEN', { mode: 0o600 })
  const rawSettings = JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8')) as Record<string, unknown>
  rawSettings.apiToken = 'SUPER-SECRET-SETTINGS-TOKEN'
  rawSettings.nested = { workerToken: 'SUPER-SECRET-NESTED-TOKEN' }
  fs.writeFileSync(paths.settingsPath, JSON.stringify(rawSettings))
  return { paths, alphaPath, betaPath, watchRoot }
}

function cleanup(...roots: AppPaths[]) {
  for (const p of roots) fs.rmSync(p.dataRoot, { recursive: true, force: true })
}

test('redactSecrets redacts tokens and secrets at any depth', () => {
  const { redacted, keys } = redactSecrets({ theme: 'dark', apiToken: 'x', nested: { worker_token: 'y', list: [{ password: 'z' }] } })
  const json = JSON.stringify(redacted)
  assert.equal(json.includes('"x"'), false)
  assert.ok(keys.some((k) => k.includes('apiToken')))
  assert.ok(keys.some((k) => k.includes('worker_token')))
  assert.ok(keys.some((k) => k.includes('password')))
})

test('round-trip export/restore preserves faces, projects, tags, filters; secrets absent', () => {
  const source = makeLibrary('backup-src-')
  const target = tempPaths('backup-dst-')
  try {
    const preview = previewBackup(source.paths)
    assert.equal(preview.fontFiles, 2)
    assert.ok(preview.uncompressedSize > 0)
    assert.equal(preview.warning, BACKUP_LICENSE_WARNING)

    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    const created = createBackup(source.paths, { destinationPath: dest })
    assert.ok(created.size > 0)
    // Wipe the fixture font files (keeping the folders) so restore must use the archive.
    fs.rmSync(source.alphaPath)
    fs.rmSync(source.betaPath)

    // Secrets absent from every extracted entry (grep-the-zip equivalent).
    const zipped = readZipFile(dest)
    assert.deepEqual(
      [...zipped.keys()].sort(),
      ['catalog.json', 'family-tags.json', 'manifest.json', 'projects.json', 'saved-filters.json', 'settings.json',
        ...[...zipped.keys()].filter((k) => k.startsWith('fonts/'))].sort(),
    )
    for (const [name, data] of zipped) {
      assert.equal(data.toString('utf8').includes('SUPER-SECRET'), false, `${name} leaked a secret`)
    }
    const manifest = JSON.parse(zipped.get('manifest.json')!.toString('utf8')) as { files: Array<{ fingerprint: string; faceIdentityKey: string | null }> }
    assert.equal(manifest.files.length, 2)
    for (const file of manifest.files) assert.match(file.fingerprint, /^[a-f0-9]{64}$/)
    assert.ok(manifest.files.some((f) => f.faceIdentityKey?.includes('Alpha-Regular')))

    const report = restoreBackup(target, dest)
    assert.equal(report.failed.length, 0, JSON.stringify(report.failed))
    assert.equal(report.restored.length, 2)
    assert.equal(report.projectsRestored, 2)

    const catalog = loadCatalog(target)
    assert.equal(catalog.entries.length, 2)
    const byId = new Map(catalog.entries.map((e) => [e.id, e]))
    const alpha = byId.get('alpha-id')!
    assert.ok(faceIdentityKey(alpha.faces, alpha.format)?.includes('Alpha-Regular'))
    assert.equal(alpha.status, 'deactivated') // was off in the backup, stays off
    assert.equal(alpha.sourcePath, source.alphaPath) // restored back at its recorded path
    assert.equal(fingerprintFile(alpha.sourcePath), alpha.sourceFingerprint)
    assert.ok((catalog.familyTags ?? []).some((r) => r.familyKey === 'Alpha' && r.tagIds.includes('custom-1')))
    assert.ok((catalog.tags ?? []).some((t) => t.id === 'custom-1'))

    const projects = loadProjects(target)
    assert.equal(projects.length, 2)
    assert.deepEqual(projects.find((p) => p.id === 'proj-1')!.members.map((m) => m.assetId).sort(), ['alpha-id', 'beta-id'])
    assert.equal(projects.find((p) => p.id === 'proj-1')!.members.find((m) => m.assetId === 'beta-id')!.pinFingerprint, byId.get('beta-id')!.sourceFingerprint)
    assert.equal(projects.find((p) => p.id === 'smart-1')!.kind, 'smart')

    const settings = loadSettings(target)
    assert.ok(settings.savedFilters.some((f) => f.id === 'filter-1'))
    assert.equal(settings.theme, 'dark') // settings replaced from the backup
    assert.ok(report.snapshotPath && fs.existsSync(report.snapshotPath))

    // Second restore is merge-only: identical fingerprints are skipped, nothing duplicated.
    const second = restoreBackup(target, dest)
    assert.equal(second.skippedIdentical.length, 2)
    assert.equal(loadCatalog(target).entries.length, 2)
  } finally {
    cleanup(source.paths, target)
  }
})

test('tampered font in archive is rejected by hash and named, others restore', () => {
  const source = makeLibrary('backup-tamper-src-')
  const target = tempPaths('backup-tamper-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })
    const zipped = readZipFile(dest)
    const fontKey = [...zipped.keys()].find((k) => k.includes('Alpha'))!
    const bytes = Buffer.from(zipped.get(fontKey)!)
    bytes[100] = bytes[100] ^ 0xff
    zipped.set(fontKey, bytes)
    const tampered = path.join(source.paths.dataRoot, 'tampered.cuttlerbackup')
    writeZipFile(tampered, [...zipped.entries()].map(([name, data]) => ({ name, data })))
    // Remove the recorded originals so restore must use the (tampered) archive bytes.
    fs.rmSync(source.alphaPath)
    fs.rmSync(source.betaPath)

    const report = restoreBackup(target, tampered)
    assert.ok(report.failed.some((f) => f.reason === 'hash-mismatch' && f.fileName.includes('Alpha')), JSON.stringify(report.failed))
    const catalog = loadCatalog(target)
    assert.equal(catalog.entries.some((e) => e.id === 'alpha-id'), false)
    assert.equal(catalog.entries.some((e) => e.id === 'beta-id'), true)
  } finally {
    cleanup(source.paths, target)
  }
})

test('font whose hash matches but cannot be parsed is reported and not restored', () => {
  const source = makeLibrary('backup-parse-src-')
  const target = tempPaths('backup-parse-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })
    const zipped = readZipFile(dest)
    const manifest = JSON.parse(zipped.get('manifest.json')!.toString('utf8')) as {
      files: Array<{ fingerprint: string; archivePath: string; fileName: string; size: number }>
    }
    const alphaFile = manifest.files.find((f) => f.fileName.includes('Alpha'))!
    const garbage = Buffer.from('not a font at all, but its hash will match the manifest')
    const fp = createHash('sha256').update(garbage).digest('hex')
    const oldPath = alphaFile.archivePath
    alphaFile.fingerprint = fp
    alphaFile.archivePath = `fonts/${fp}/${alphaFile.fileName}`
    alphaFile.size = garbage.length
    zipped.delete(oldPath)
    zipped.set(alphaFile.archivePath, garbage)
    zipped.set('manifest.json', Buffer.from(JSON.stringify(manifest)))
    // Keep the entry's recorded fingerprint aligned so the hash gate passes and parse is the gate that fires.
    const catalog = JSON.parse(zipped.get('catalog.json')!.toString('utf8')) as { entries: Array<{ id: string; sourceFingerprint?: string }> }
    catalog.entries.find((e) => e.id === 'alpha-id')!.sourceFingerprint = fp
    zipped.set('catalog.json', Buffer.from(JSON.stringify(catalog)))
    const corrupted = path.join(source.paths.dataRoot, 'corrupted.cuttlerbackup')
    writeZipFile(corrupted, [...zipped.entries()].map(([name, data]) => ({ name, data })))
    fs.rmSync(source.alphaPath)
    fs.rmSync(source.betaPath)

    const report = restoreBackup(target, corrupted)
    assert.ok(report.failed.some((f) => f.reason === 'parse-failed' && f.fileName.includes('Alpha')), JSON.stringify(report.failed))
    assert.equal(loadCatalog(target).entries.some((e) => e.id === 'alpha-id'), false)
    assert.equal(loadCatalog(target).entries.some((e) => e.id === 'beta-id'), true)
  } finally {
    cleanup(source.paths, target)
  }
})

test('restore never overwrites or removes the only copy of an existing face', () => {
  const source = makeLibrary('backup-keep-src-')
  const target = tempPaths('backup-keep-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })

    // Target already has: (a) its only copy of Gamma, (b) a different-bytes Alpha (same face identity).
    const gammaPath = path.join(target.dataRoot, 'Gamma.ttf')
    writeTestFont(gammaPath, 'Gamma', 'Gamma-Regular')
    const otherAlphaPath = path.join(target.dataRoot, 'AlphaOther.ttf')
    writeTestFont(otherAlphaPath, 'Alpha', 'Alpha-Regular', { version: 'Version 2.000' })
    const gamma = entryFor('gamma-id', gammaPath, 'Gamma', 'Gamma-Regular', { status: 'installed', installedPath: gammaPath })
    const otherAlpha = entryFor('other-alpha-id', otherAlphaPath, 'Alpha', 'Alpha-Regular', { status: 'installed', installedPath: otherAlphaPath })
    saveCatalog(target, { version: 1, entries: [gamma, otherAlpha] })
    const gammaBefore = fingerprintFile(gammaPath)
    const otherBefore = fingerprintFile(otherAlphaPath)

    const report = restoreBackup(target, dest)
    const catalog = loadCatalog(target)
    // Only copies untouched: files, fingerprints, entries, installed status.
    assert.equal(fingerprintFile(gammaPath), gammaBefore)
    assert.equal(fingerprintFile(otherAlphaPath), otherBefore)
    const keptGamma = catalog.entries.find((e) => e.id === 'gamma-id')!
    assert.equal(keptGamma.status, 'installed')
    // Conflicting Alpha: existing keeper stays installed, restored copy parked as extra, both stay.
    assert.ok(report.parkedAsExtra.some((r) => r.conflictingEntryId === 'other-alpha-id'), JSON.stringify(report))
    const restoredAlpha = catalog.entries.find((e) => e.id === 'alpha-id')!
    assert.equal(restoredAlpha.status, 'deactivated')
    assert.notEqual(restoredAlpha.sourcePath, otherAlphaPath)
    // Beta restored normally, nothing deleted.
    assert.ok(catalog.entries.length >= 4)
  } finally {
    cleanup(source.paths, target)
  }
})

test('manifest version mismatch is refused with a clear message and changes nothing', () => {
  const source = makeLibrary('backup-ver-src-')
  const target = tempPaths('backup-ver-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })
    const zipped = readZipFile(dest)
    const manifest = JSON.parse(zipped.get('manifest.json')!.toString('utf8')) as Record<string, unknown>
    manifest.formatVersion = 99
    zipped.set('manifest.json', Buffer.from(JSON.stringify(manifest)))
    const bad = path.join(source.paths.dataRoot, 'bad-version.cuttlerbackup')
    writeZipFile(bad, [...zipped.entries()].map(([name, data]) => ({ name, data })))
    assert.throws(() => restoreBackup(target, bad), /format version 99/)
    assert.equal(fs.existsSync(target.catalogPath), false)
  } finally {
    cleanup(source.paths, target)
  }
})

test('watch-folder roots: present roots restored paused, absent roots reported for relink', () => {
  const source = makeLibrary('backup-watch-src-')
  const target = tempPaths('backup-watch-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })

    const plan = planRestore(target, dest)
    // watchRoot exists on this machine (same fs), so plan offers it paused; after removing it, restore reports it.
    assert.ok(plan.watchFoldersRestoredPaused.some((f) => f.root === source.watchRoot))
    fs.rmSync(source.watchRoot, { recursive: true, force: true })
    const report = restoreBackup(target, dest)
    assert.ok(report.watchFoldersNotRestored.some((f) => f.root === source.watchRoot && f.reason.includes('relink to resume watching')))
    const settings = loadSettings(target)
    assert.equal(settings.folders.some((f) => f.root === source.watchRoot), false)
    assert.ok(loadCatalog(target).entries.length > 0)
  } finally {
    cleanup(source.paths, target)
  }
})

test('omit-fonts backup contains no font files and restores organisation only', () => {
  const source = makeLibrary('backup-nofonts-src-')
  const target = tempPaths('backup-nofonts-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'meta.cuttlerbackup')
    const created = createBackup(source.paths, { destinationPath: dest, includeFonts: false })
    assert.equal(created.manifest.includesFonts, false)
    assert.equal(created.preview.fontFiles, 0)
    const zipped = readZipFile(dest)
    assert.equal([...zipped.keys()].some((k) => k.startsWith('fonts/')), false)

    const report = restoreBackup(target, dest)
    assert.equal(report.includesFonts, false)
    assert.equal(loadCatalog(target).entries.length, 0)
    assert.ok(report.failed.some((f) => f.message.includes('no font files')))
    // Organisation still restores.
    assert.deepEqual(loadProjects(target).map((p) => p.id).sort(), ['proj-1', 'smart-1'])
    assert.equal(loadSettings(target).theme, 'dark')
  } finally {
    cleanup(source.paths, target)
  }
})

test('organisation restore replaces projects, tags and settings after a snapshot', () => {
  const source = makeLibrary('backup-replace-src-')
  const target = tempPaths('backup-replace-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })

    // Target has its own organisation plus an only-copy font that must survive.
    const gammaPath = path.join(target.dataRoot, 'Gamma.ttf')
    writeTestFont(gammaPath, 'Gamma', 'Gamma-Regular')
    saveCatalog(target, {
      version: 1,
      entries: [entryFor('gamma-id', gammaPath, 'Gamma', 'Gamma-Regular', { status: 'installed', installedPath: gammaPath })],
      tags: [{ id: 'old-tag', name: 'Old tag', color: '#000000' }],
      familyTags: [{ familyKey: 'Gamma', tagIds: ['old-tag'] }],
    })
    saveProjects(target, [{ id: 'old-proj', name: 'Old project', members: [{ assetId: 'gamma-id' }], desiredActive: false }])
    const targetSettings = loadSettings(target)
    targetSettings.theme = 'light'
    targetSettings.savedFilters = [{ id: 'old-filter', name: 'Old', query: '', libraryFilters: [], watchFolder: null, createdAt: 1 }]
    saveSettings(target, targetSettings)
    const gammaBefore = fingerprintFile(gammaPath)

    const report = restoreBackup(target, dest)
    assert.ok(report.snapshotPath && fs.existsSync(report.snapshotPath), JSON.stringify(report))
    const snapshotProjects = JSON.parse(fs.readFileSync(path.join(report.snapshotPath!, 'projects.json'), 'utf8')) as { projects: Array<{ id: string }> }
    assert.ok(snapshotProjects.projects.some((p) => p.id === 'old-proj'))
    assert.ok(fs.existsSync(path.join(report.snapshotPath!, 'settings.json')))
    assert.ok(report.catalogBackupPath && fs.existsSync(report.catalogBackupPath))

    // Replaced, not merged.
    assert.deepEqual(loadProjects(target).map((p) => p.id).sort(), ['proj-1', 'smart-1'])
    const catalog = loadCatalog(target)
    assert.equal((catalog.tags ?? []).some((t) => t.id === 'old-tag'), false)
    assert.ok((catalog.tags ?? []).some((t) => t.id === 'custom-1'))
    assert.equal(loadSettings(target).theme, 'dark')
    assert.equal(loadSettings(target).savedFilters.some((f) => f.id === 'old-filter'), false)
    // The only copy was neither deleted nor parked.
    assert.equal(fingerprintFile(gammaPath), gammaBefore)
    assert.equal(catalog.entries.find((e) => e.id === 'gamma-id')!.status, 'installed')

    // Fonts-only restore leaves organisation alone.
    const projectsBefore = loadProjects(target).map((p) => p.id)
    const fontsOnly = restoreBackup(target, dest, { restoreOrganization: false, restoreFonts: true })
    assert.equal(fontsOnly.restoreOrganization, false)
    assert.equal(fontsOnly.snapshotPath, null)
    assert.deepEqual(loadProjects(target).map((p) => p.id), projectsBefore)
  } finally {
    cleanup(source.paths, target)
  }
})

test('fonts that were on come back on; temporary/session activations stay off', () => {
  const paths = tempPaths('backup-on-src-')
  const target = tempPaths('backup-on-dst-')
  try {
    const srcDir = path.join(paths.dataRoot, 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    const onPath = path.join(srcDir, 'On.ttf')
    const tempPathFile = path.join(srcDir, 'Temp.ttf')
    writeTestFont(onPath, 'OnFam', 'OnFam-Regular')
    writeTestFont(tempPathFile, 'TempFam', 'TempFam-Regular')
    const installedCopy = path.join(paths.installDir, 'On.ttf')
    fs.mkdirSync(paths.installDir, { recursive: true })
    fs.copyFileSync(onPath, installedCopy)
    saveCatalog(paths, {
      version: 1,
      entries: [
        entryFor('on-id', onPath, 'OnFam', 'OnFam-Regular', { status: 'installed', installedPath: installedCopy, installedFingerprint: fingerprintFile(onPath) }),
        entryFor('temp-id', tempPathFile, 'TempFam', 'TempFam-Regular', { status: 'installed', installedPath: tempPathFile, temporaryActivation: true }),
      ],
    })
    const dest = path.join(paths.dataRoot, 'on.cuttlerbackup')
    createBackup(paths, { destinationPath: dest })
    fs.rmSync(onPath)
    fs.rmSync(tempPathFile)
    fs.rmSync(installedCopy)

    const report = restoreBackup(target, dest, { restoreOrganization: false })
    assert.ok(report.reactivated.some((r) => r.entryId === 'on-id'), JSON.stringify(report))
    const catalog = loadCatalog(target)
    const on = catalog.entries.find((e) => e.id === 'on-id')!
    assert.equal(on.status, 'installed')
    assert.ok(on.installedPath && fs.existsSync(on.installedPath))
    assert.equal(fingerprintFile(on.installedPath!), fingerprintFile(on.sourcePath))
    const temp = catalog.entries.find((e) => e.id === 'temp-id')!
    assert.equal(temp.status, 'deactivated')
    assert.equal(temp.installedPath, undefined)
  } finally {
    cleanup(paths, target)
  }
})

test('a file already on disk at the recorded path is left untouched, fingerprint or not', () => {
  const source = makeLibrary('backup-leftasis-src-')
  const target = tempPaths('backup-leftasis-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })
    // Different bytes now sit at Alpha's recorded path. Restore must not overwrite or reject it.
    writeTestFont(source.alphaPath, 'Alpha', 'Alpha-Regular', { version: 'Version 9.999' })
    const before = fingerprintFile(source.alphaPath)
    const archiveFp = loadCatalog(source.paths).entries.find((e) => e.id === 'alpha-id')!.sourceFingerprint
    assert.notEqual(before, archiveFp)

    const report = restoreBackup(target, dest)
    assert.equal(fingerprintFile(source.alphaPath), before)
    assert.ok(report.leftAsIs.some((r) => r.entryId === 'alpha-id' && r.recordedPath === source.alphaPath), JSON.stringify(report.leftAsIs))
    const alpha = loadCatalog(target).entries.find((e) => e.id === 'alpha-id')!
    assert.equal(alpha.sourcePath, source.alphaPath)
  } finally {
    cleanup(source.paths, target)
  }
})

test('protected system/app fonts are not archived', () => {
  const source = makeLibrary('backup-protected-src-')
  try {
    const protectedPath = path.join(source.paths.systemFontsDir, 'System.ttf')
    writeTestFont(protectedPath, 'SysFam', 'SysFam-Regular')
    const catalog = loadCatalog(source.paths)
    catalog.entries.push(entryFor('sys-id', protectedPath, 'SysFam', 'SysFam-Regular'))
    saveCatalog(source.paths, catalog)

    const preview = previewBackup(source.paths)
    assert.ok(preview.skippedProtected.some((s) => s.entryId === 'sys-id'), JSON.stringify(preview.skippedProtected))
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    const created = createBackup(source.paths, { destinationPath: dest })
    assert.equal(created.manifest.files.some((f) => f.entries.some((r) => r.entryId === 'sys-id')), false)
    assert.ok(created.manifest.skippedProtected.some((s) => s.entryId === 'sys-id'))
  } finally {
    cleanup(source.paths)
  }
})

test('watch-folder present at restore is added paused and not watching', () => {
  const source = makeLibrary('backup-watch2-src-')
  const target = tempPaths('backup-watch2-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })
    const report = restoreBackup(target, dest)
    assert.ok(report.watchFoldersRestoredPaused.some((f) => f.root === source.watchRoot))
    const folder = loadSettings(target).folders.find((f) => f.root === source.watchRoot)!
    assert.equal(folder.paused, true)
    assert.equal(folder.watching, false)
  } finally {
    cleanup(source.paths, target)
  }
})

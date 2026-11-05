import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  BACKUP_LICENSE_WARNING,
  createBackup,
  isProtectedFontPath,
  planRestore,
  previewBackup,
  readZipFile,
  redactSecrets,
  restoreBackup,
  writeZipFile,
} from './backup.ts'
import { faceIdentityKey, loadCatalog, saveCatalog } from './catalog.ts'
import { isUnderAnyRoot } from './containment.ts'
import { fingerprintBuffer, fingerprintFile } from './fingerprint.ts'
import { createWatchFolder } from './folders.ts'
import { loadProjects, saveProjects } from './projects.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { saveSessionActivationIds } from './session-activation.ts'
import { tempPaths, withService, writeTestFont } from './test-util.ts'
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

test('tampered font in archive refuses the whole restore — no fonts, no organisation', () => {
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

    // Target organisation that must survive untouched.
    saveProjects(target, [{ id: 'keep-proj', name: 'Keep me', members: [], desiredActive: false }])
    const targetSettings = loadSettings(target)
    targetSettings.theme = 'light'
    saveSettings(target, targetSettings)

    assert.throws(() => restoreBackup(target, tampered), /has been changed since it was made/)
    assert.throws(() => planRestore(target, tampered), /has been changed since it was made/)
    // Nothing applied: no fonts, organisation not replaced, no snapshot taken.
    assert.equal(loadCatalog(target).entries.length, 0)
    assert.deepEqual(loadProjects(target).map((p) => p.id), ['keep-proj'])
    assert.equal(loadSettings(target).theme, 'light')
    assert.equal(fs.existsSync(path.join(target.dataRoot, 'Backups')), false)
  } finally {
    cleanup(source.paths, target)
  }
})

test('re-packed archive with edited projects.json is refused and changes nothing', () => {
  const source = makeLibrary('backup-sidecar-src-')
  const target = tempPaths('backup-sidecar-dst-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })
    const zipped = readZipFile(dest)
    const projects = JSON.parse(zipped.get('projects.json')!.toString('utf8')) as { projects: Array<{ name: string }> }
    projects.projects[0]!.name = 'TAMPERED PROJECT'
    zipped.set('projects.json', Buffer.from(JSON.stringify(projects)))
    const tampered = path.join(source.paths.dataRoot, 'tampered-projects.cuttlerbackup')
    writeZipFile(tampered, [...zipped.entries()].map(([name, data]) => ({ name, data })))

    saveProjects(target, [{ id: 'keep-proj', name: 'Keep me', members: [], desiredActive: false }])
    assert.throws(() => restoreBackup(target, tampered), /projects\.json does not match its fingerprint/)
    assert.deepEqual(loadProjects(target).map((p) => p.name), ['Keep me'])
    assert.equal(loadCatalog(target).entries.length, 0)
  } finally {
    cleanup(source.paths, target)
  }
})

test('archive with stripped or incomplete sidecarSha256 refuses the whole restore', () => {
  const source = makeLibrary('backup-strip-src-')
  try {
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    createBackup(source.paths, { destinationPath: dest })

    const variants: Array<{ name: string; strip: (manifest: Record<string, unknown>) => void }> = [
      { name: 'deleted', strip: (m) => { delete m.sidecarSha256 } },
      { name: 'empty', strip: (m) => { m.sidecarSha256 = {} } },
      {
        name: 'missing-key',
        strip: (m) => {
          const hashes = { ...(m.sidecarSha256 as Record<string, string>) }
          delete hashes['projects.json']
          m.sidecarSha256 = hashes
        },
      },
    ]

    for (const variant of variants) {
      const target = tempPaths(`backup-strip-${variant.name}-dst-`)
      try {
        const zipped = readZipFile(dest)
        const manifest = JSON.parse(zipped.get('manifest.json')!.toString('utf8')) as Record<string, unknown>
        variant.strip(manifest)
        zipped.set('manifest.json', Buffer.from(JSON.stringify(manifest)))
        const projects = JSON.parse(zipped.get('projects.json')!.toString('utf8')) as { projects: Array<{ name: string }> }
        projects.projects[0]!.name = 'TAMPERED PROJECT'
        zipped.set('projects.json', Buffer.from(JSON.stringify(projects)))
        const tampered = path.join(source.paths.dataRoot, `stripped-${variant.name}.cuttlerbackup`)
        writeZipFile(tampered, [...zipped.entries()].map(([name, data]) => ({ name, data })))

        // Target state that must survive completely untouched.
        saveProjects(target, [{ id: 'keep-proj', name: 'Keep me', members: [], desiredActive: false }])
        const targetSettings = loadSettings(target)
        targetSettings.theme = 'light'
        saveSettings(target, targetSettings)

        assert.throws(() => restoreBackup(target, tampered), /sidecarSha256|content fingerprint/, variant.name)
        assert.throws(() => planRestore(target, tampered), /sidecarSha256|content fingerprint/, variant.name)
        // Fonts, projects, settings, and Backups are all untouched.
        assert.equal(loadCatalog(target).entries.length, 0, variant.name)
        assert.deepEqual(loadProjects(target).map((p) => p.name), ['Keep me'], variant.name)
        assert.equal(loadSettings(target).theme, 'light', variant.name)
        assert.equal(fs.existsSync(path.join(target.dataRoot, 'Backups')), false, variant.name)
        assert.equal(fs.existsSync(path.join(target.dataRoot, 'Restored')), false, variant.name)
      } finally {
        cleanup(target)
      }
    }
  } finally {
    cleanup(source.paths)
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
    // Re-sign the sidecars: this archive is deliberately re-made, not tampered with unknowingly.
    const manifestFull = JSON.parse(zipped.get('manifest.json')!.toString('utf8')) as { sidecarSha256?: Record<string, string> }
    if (manifestFull.sidecarSha256) {
      for (const name of Object.keys(manifestFull.sidecarSha256)) {
        const data = zipped.get(name)
        if (data) manifestFull.sidecarSha256[name] = fingerprintBuffer(data)
      }
      zipped.set('manifest.json', Buffer.from(JSON.stringify(manifestFull)))
    }
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

test('protected paths match Cicero isProtected exactly', () => {
  // Skipped: protected prefixes, any .app bundle, Adobe Fonts (CoreSync).
  for (const p of [
    '/System/Library/Fonts/Sys.ttf',
    '/Library/Application Support/Apple/Fonts/Apple.ttf',
    '/usr/share/fonts/Usr.ttf',
    '/private/var/fonts/Priv.ttf',
    '/Applications/Demo.app/Contents/Resources/Fonts/Bundled.ttf',
    '/tmp/somewhere/Demo.app/Contents/Resources/Fonts/Bundled.ttf',
    '/Users/x/Library/Application Support/Adobe/CoreSync/plugins/livetype/Synced.ttf',
    '/tmp/Adobe/CoreSync/Synced.ttf',
  ]) {
    assert.equal(isProtectedFontPath(p), true, p)
  }
  // Not skipped: all-users fonts and the Adobe shared fonts folder are archived.
  for (const p of [
    '/Library/Fonts/AllUsers.ttf',
    '/Library/Application Support/Adobe/Fonts/Shared.ttf',
    '/Users/x/Library/Fonts/User.ttf',
    '/tmp/normal/Normal.ttf',
  ]) {
    assert.equal(isProtectedFontPath(p), false, p)
  }
})

test('protected .app bundle and CoreSync fonts are not archived', () => {
  const source = makeLibrary('backup-protected-src-')
  try {
    const appPath = path.join(source.paths.dataRoot, 'Demo.app', 'Contents', 'Resources', 'Fonts', 'Bundled.ttf')
    const coreSyncPath = path.join(source.paths.dataRoot, 'Adobe', 'CoreSync', 'plugins', 'livetype', 'Synced.ttf')
    writeTestFont(appPath, 'BundledFam', 'BundledFam-Regular')
    writeTestFont(coreSyncPath, 'SyncedFam', 'SyncedFam-Regular')
    const catalog = loadCatalog(source.paths)
    catalog.entries.push(entryFor('app-id', appPath, 'BundledFam', 'BundledFam-Regular'))
    catalog.entries.push(entryFor('coresync-id', coreSyncPath, 'SyncedFam', 'SyncedFam-Regular'))
    saveCatalog(source.paths, catalog)

    const preview = previewBackup(source.paths)
    assert.ok(preview.skippedProtected.some((s) => s.entryId === 'app-id'), JSON.stringify(preview.skippedProtected))
    assert.ok(preview.skippedProtected.some((s) => s.entryId === 'coresync-id'), JSON.stringify(preview.skippedProtected))
    const dest = path.join(source.paths.dataRoot, 'library.cuttlerbackup')
    const created = createBackup(source.paths, { destinationPath: dest })
    assert.equal(created.manifest.files.some((f) => f.entries.some((r) => r.entryId === 'app-id')), false)
    assert.equal(created.manifest.files.some((f) => f.entries.some((r) => r.entryId === 'coresync-id')), false)
    assert.ok(created.manifest.skippedProtected.some((s) => s.entryId === 'app-id'))
    assert.ok(created.manifest.skippedProtected.some((s) => s.entryId === 'coresync-id'))
    // The normal library fonts are still archived.
    assert.ok(created.manifest.files.some((f) => f.entries.some((r) => r.entryId === 'alpha-id')))
  } finally {
    cleanup(source.paths)
  }
})

test('a font that was on is not reactivated onto a different file occupying its install name', () => {
  const paths = tempPaths('backup-collide-src-')
  const target = tempPaths('backup-collide-dst-')
  try {
    const srcDir = path.join(paths.dataRoot, 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    const onPath = path.join(srcDir, 'On.ttf')
    writeTestFont(onPath, 'OnFam', 'OnFam-Regular')
    const installedCopy = path.join(paths.installDir, 'On.ttf')
    fs.mkdirSync(paths.installDir, { recursive: true })
    fs.copyFileSync(onPath, installedCopy)
    saveCatalog(paths, {
      version: 1,
      entries: [entryFor('on-id', onPath, 'OnFam', 'OnFam-Regular', { status: 'installed', installedPath: installedCopy, installedFingerprint: fingerprintFile(onPath) })],
    })
    const dest = path.join(paths.dataRoot, 'on.cuttlerbackup')
    createBackup(paths, { destinationPath: dest })
    fs.rmSync(onPath)
    fs.rmSync(installedCopy)

    // A different font already occupies the install filename in the target.
    const occupantPath = path.join(target.installDir, 'On.ttf')
    writeTestFont(occupantPath, 'OtherFam', 'OtherFam-Regular')
    const occupantBefore = fingerprintFile(occupantPath)

    const report = restoreBackup(target, dest, { restoreOrganization: false })
    // Occupant untouched and not adopted as the restored copy.
    assert.equal(fingerprintFile(occupantPath), occupantBefore)
    const on = loadCatalog(target).entries.find((e) => e.id === 'on-id')!
    assert.equal(on.status, 'installed')
    assert.ok(on.installedPath, 'installedPath set')
    assert.notEqual(path.resolve(on.installedPath!), path.resolve(occupantPath))
    // The reactivated copy holds the restored OnFam bytes, not the occupant's.
    assert.equal(fingerprintFile(on.installedPath!), on.sourceFingerprint)
    assert.notEqual(fingerprintFile(on.installedPath!), occupantBefore)
    assert.ok(report.reactivated.some((r) => r.entryId === 'on-id'))
  } finally {
    cleanup(paths, target)
  }
})

function assertDisabledIsNotSource(entry: CatalogEntry, disabledDir: string): void {
  assert.notEqual(path.resolve(entry.disabledPath ?? 'disabled-unset'), path.resolve(entry.sourcePath))
  if (entry.disabledPath) assert.equal(isUnderAnyRoot(entry.disabledPath, [disabledDir]), true)
}

test('restored off fonts do not use the source file as the parked copy', async () => {
  const source = tempPaths('backup-source-safe-src-')
  try {
    const srcDir = path.join(source.dataRoot, 'library-src')
    const goneDir = path.join(source.dataRoot, 'gone')
    fs.mkdirSync(srcDir, { recursive: true })
    fs.mkdirSync(goneDir, { recursive: true })
    const acmePath = path.join(srcDir, 'Acme.ttf')
    const boldPath = path.join(srcDir, 'Acme-Bold.ttf')
    const vaultPath = path.join(goneDir, 'Vault.ttf')
    writeTestFont(acmePath, 'Acme', 'Acme-Regular')
    writeTestFont(boldPath, 'Acme', 'Acme-Bold', { style: 'Bold' })
    writeTestFont(vaultPath, 'Vault', 'Vault-Regular')
    saveCatalog(source, {
      version: 1,
      entries: [
        entryFor('acme-id', acmePath, 'Acme', 'Acme-Regular', { status: 'deactivated', disabledPath: acmePath }),
        entryFor('bold-id', boldPath, 'Acme', 'Acme-Bold', {
          status: 'deactivated',
          disabledPath: boldPath,
          faces: [{ familyName: 'Acme', styleName: 'Bold', fullName: 'Acme Bold', postscriptName: 'Acme-Bold', isVariable: false, instanceCount: 1, instanceNames: [], weight: 700, italic: false }],
        }),
        entryFor('vault-id', vaultPath, 'Vault', 'Vault-Regular'),
      ],
    })
    const dest = path.join(source.dataRoot, 'library.cuttlerbackup')
    createBackup(source, { destinationPath: dest })
    fs.rmSync(acmePath)
    fs.rmSync(boldPath)
    fs.rmSync(goneDir, { recursive: true, force: true })

    await withService(async (service, target) => {
      const report = restoreBackup(target, dest, { restoreOrganization: false })
      assert.equal(report.failed.length, 0, JSON.stringify(report.failed))
      const catalog = loadCatalog(target)
      const acme = catalog.entries.find((entry) => entry.id === 'acme-id')!
      const bold = catalog.entries.find((entry) => entry.id === 'bold-id')!
      const vault = catalog.entries.find((entry) => entry.id === 'vault-id')!
      assert.equal(acme.sourcePath, acmePath)
      assert.equal(bold.sourcePath, boldPath)
      assert.ok(vault.sourcePath.includes(`${path.sep}Restored${path.sep}`), vault.sourcePath)
      assertDisabledIsNotSource(acme, target.disabledDir)
      assertDisabledIsNotSource(bold, target.disabledDir)
      assertDisabledIsNotSource(vault, target.disabledDir)
      assert.equal(acme.sourceAvailability, 'present')
      assert.equal(acme.sourcePresent, true)
      assert.equal(bold.sourceAvailability, 'present')
      assert.equal(vault.sourceAvailability, 'present')
      assert.equal(fs.existsSync(acmePath), true)
      assert.equal(fs.existsSync(boldPath), true)
      const acmeIno = fs.statSync(acmePath).ino
      const boldIno = fs.statSync(boldPath).ino
      const vaultFile = vault.sourcePath
      const vaultIno = fs.statSync(vaultFile).ino

      await service.uninstall('acme-id', { deleteSource: false })
      assert.equal(fs.existsSync(acmePath), true)
      assert.equal(fs.statSync(acmePath).ino, acmeIno)
      await service.uninstall('vault-id', { deleteSource: false })
      assert.equal(fs.existsSync(vaultFile), true)
      assert.equal(fs.statSync(vaultFile).ino, vaultIno)

      const activated = await service.activate('bold-id')
      assert.equal(fs.existsSync(boldPath), true)
      assert.equal(fs.statSync(boldPath).ino, boldIno)
      assert.equal(path.resolve(activated.sourcePath), path.resolve(boldPath))
      assert.ok(activated.installedPath)
      assert.notEqual(path.resolve(activated.installedPath), path.resolve(boldPath))
      assert.equal(fs.existsSync(activated.installedPath), true)
      assert.equal(isUnderAnyRoot(activated.installedPath, [target.installDir, target.userFontsDir]), true)
    }, { prefix: 'backup-source-safe-dst-' })
  } finally {
    cleanup(source)
  }
})

test('activate-until-quit fonts stay off after restore', () => {
  const paths = tempPaths('backup-session-src-')
  const target = tempPaths('backup-session-dst-')
  const planPaths = tempPaths('backup-session-plan-')
  try {
    const srcDir = path.join(paths.dataRoot, 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    const onPath = path.join(srcDir, 'On.ttf')
    const sessionPath = path.join(srcDir, 'Session.ttf')
    writeTestFont(onPath, 'OnFam', 'OnFam-Regular')
    writeTestFont(sessionPath, 'SessionFam', 'SessionFam-Regular')
    const installedCopy = path.join(paths.installDir, 'On.ttf')
    fs.mkdirSync(paths.installDir, { recursive: true })
    fs.copyFileSync(onPath, installedCopy)
    fs.copyFileSync(sessionPath, path.join(paths.installDir, 'Session.ttf'))
    saveCatalog(paths, {
      version: 1,
      entries: [
        entryFor('on-id', onPath, 'OnFam', 'OnFam-Regular', { status: 'installed', installedPath: installedCopy, installedFingerprint: fingerprintFile(onPath) }),
        entryFor('session-id', sessionPath, 'SessionFam', 'SessionFam-Regular', {
          status: 'installed',
          installedPath: path.join(paths.installDir, 'Session.ttf'),
          installedFingerprint: fingerprintFile(sessionPath),
        }),
      ],
    })
    saveSessionActivationIds(paths, ['session-id'])
    const dest = path.join(paths.dataRoot, 'session.cuttlerbackup')
    const created = createBackup(paths, { destinationPath: dest })
    const sessionRefs = created.manifest.files.flatMap((file) => file.entries).filter((ref) => ref.entryId === 'session-id')
    assert.ok(sessionRefs.length > 0)
    assert.ok(sessionRefs.every((ref) => ref.activation === 'temporary'))
    const plan = planRestore(planPaths, dest, { restoreOrganization: false })
    assert.equal(plan.reactivated.some((row) => row.entryId === 'session-id'), false)
    assert.ok(plan.reactivated.some((row) => row.entryId === 'on-id'))

    fs.rmSync(onPath)
    fs.rmSync(sessionPath)
    fs.rmSync(installedCopy)
    fs.rmSync(path.join(paths.installDir, 'Session.ttf'))
    const report = restoreBackup(target, dest, { restoreOrganization: false })
    assert.equal(report.reactivated.some((row) => row.entryId === 'session-id'), false)
    assert.ok(report.reactivated.some((row) => row.entryId === 'on-id'))
    const catalog = loadCatalog(target)
    const session = catalog.entries.find((entry) => entry.id === 'session-id')!
    assert.equal(session.status, 'deactivated')
    assert.equal(session.installedPath, undefined)
    assert.equal(session.temporaryActivation, undefined)
    assertDisabledIsNotSource(session, target.disabledDir)
    const on = catalog.entries.find((entry) => entry.id === 'on-id')!
    assert.equal(on.status, 'installed')
    assert.ok(on.installedPath && fs.existsSync(on.installedPath))
  } finally {
    cleanup(paths, target, planPaths)
  }
})

test('activate-until-quit stays on when a project still owns the face', () => {
  const paths = tempPaths('backup-session-owned-src-')
  const target = tempPaths('backup-session-owned-dst-')
  try {
    const srcDir = path.join(paths.dataRoot, 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    const sessionPath = path.join(srcDir, 'Session.ttf')
    const ownedPath = path.join(srcDir, 'Owned.ttf')
    writeTestFont(sessionPath, 'SessionFam', 'SessionFam-Regular')
    writeTestFont(ownedPath, 'OwnedFam', 'OwnedFam-Regular')
    fs.mkdirSync(paths.installDir, { recursive: true })
    const sessionInstalled = path.join(paths.installDir, 'Session.ttf')
    const ownedInstalled = path.join(paths.installDir, 'Owned.ttf')
    fs.copyFileSync(sessionPath, sessionInstalled)
    fs.copyFileSync(ownedPath, ownedInstalled)
    saveCatalog(paths, {
      version: 1,
      entries: [
        entryFor('session-id', sessionPath, 'SessionFam', 'SessionFam-Regular', {
          status: 'installed',
          installedPath: sessionInstalled,
          installedFingerprint: fingerprintFile(sessionPath),
        }),
        entryFor('owned-id', ownedPath, 'OwnedFam', 'OwnedFam-Regular', {
          status: 'installed',
          installedPath: ownedInstalled,
          installedFingerprint: fingerprintFile(ownedPath),
          activationOwners: [{ kind: 'project', projectId: 'proj-live' }],
        }),
      ],
    })
    saveSessionActivationIds(paths, ['session-id', 'owned-id'])
    const dest = path.join(paths.dataRoot, 'owned.cuttlerbackup')
    const created = createBackup(paths, { destinationPath: dest })
    const activationFor = (id: string) => created.manifest.files.flatMap((file) => file.entries).filter((ref) => ref.entryId === id).map((ref) => ref.activation)
    assert.ok(activationFor('session-id').every((activation) => activation === 'temporary'))
    assert.ok(activationFor('owned-id').every((activation) => activation === 'on'))

    fs.rmSync(sessionPath)
    fs.rmSync(ownedPath)
    fs.rmSync(sessionInstalled)
    fs.rmSync(ownedInstalled)
    const report = restoreBackup(target, dest, { restoreOrganization: false })
    assert.equal(report.reactivated.some((row) => row.entryId === 'session-id'), false)
    assert.ok(report.reactivated.some((row) => row.entryId === 'owned-id'))
    const catalog = loadCatalog(target)
    const session = catalog.entries.find((entry) => entry.id === 'session-id')!
    const owned = catalog.entries.find((entry) => entry.id === 'owned-id')!
    assert.equal(session.status, 'deactivated')
    assert.equal(session.installedPath, undefined)
    assert.equal(owned.status, 'installed')
    assert.ok(owned.installedPath && fs.existsSync(owned.installedPath))
    assert.equal(owned.sourceAvailability, 'present')
    assert.equal(session.sourceAvailability, 'present')
  } finally {
    cleanup(paths, target)
  }
})

test('a parked vault file is not adopted as the restored source', () => {
  const paths = tempPaths('backup-vault-only-')
  try {
    const srcDir = path.join(paths.dataRoot, 'library-src')
    fs.mkdirSync(srcDir, { recursive: true })
    const sourcePath = path.join(srcDir, 'Parked.ttf')
    writeTestFont(sourcePath, 'ParkedFam', 'ParkedFam-Regular')
    fs.mkdirSync(paths.disabledDir, { recursive: true })
    const vaultPath = path.join(paths.disabledDir, 'Parked.ttf')
    fs.copyFileSync(sourcePath, vaultPath)
    const vaultIno = fs.statSync(vaultPath).ino
    saveCatalog(paths, {
      version: 1,
      entries: [
        entryFor('parked-id', sourcePath, 'ParkedFam', 'ParkedFam-Regular', {
          status: 'deactivated',
          disabledPath: vaultPath,
        }),
      ],
    })
    const dest = path.join(paths.dataRoot, 'vault.cuttlerbackup')
    createBackup(paths, { destinationPath: dest })
    fs.rmSync(sourcePath)
    saveCatalog(paths, { version: 1, entries: [] })

    const plan = planRestore(paths, dest, { restoreOrganization: false })
    assert.equal(plan.leftAsIs.some((row) => row.entryId === 'parked-id'), false)
    assert.ok(plan.restored.some((row) => row.entryId === 'parked-id'))

    const report = restoreBackup(paths, dest, { restoreOrganization: false })
    assert.equal(report.failed.length, 0, JSON.stringify(report.failed))
    const restored = loadCatalog(paths).entries.find((entry) => entry.id === 'parked-id')!
    assert.equal(path.resolve(restored.sourcePath), path.resolve(sourcePath))
    assert.equal(fs.existsSync(sourcePath), true)
    assert.equal(isUnderAnyRoot(restored.sourcePath, [paths.disabledDir]), false)
    assert.equal(path.resolve(restored.disabledPath ?? ''), path.resolve(vaultPath))
    assert.equal(fs.existsSync(vaultPath), true)
    assert.equal(fs.statSync(vaultPath).ino, vaultIno)
    assert.equal(restored.sourceAvailability, 'present')
    assert.equal(report.leftAsIs.some((row) => row.recordedPath === vaultPath), false)
  } finally {
    cleanup(paths)
  }
})

test('restore puts back family ratings, comments, and retired tag seeds', () => {
  const source = tempPaths('backup-details-src-')
  const target = tempPaths('backup-details-dst-')
  const fontsOnly = tempPaths('backup-details-fonts-')
  try {
    const srcDir = path.join(source.dataRoot, 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    const fontPath = path.join(srcDir, 'Alpha.ttf')
    writeTestFont(fontPath, 'Alpha', 'Alpha-Regular')
    saveCatalog(source, {
      version: 1,
      entries: [entryFor('alpha-id', fontPath, 'Alpha', 'Alpha-Regular')],
      tags: [
        { id: 'licensed', name: 'Licensed', color: '#1f8a4c', seed: 'licensed' },
        { id: 'custom-1', name: 'Client work', color: '#7c5cbf' },
      ],
      familyTags: [{ familyKey: 'Alpha', tagIds: ['custom-1'] }],
      familyDetails: [
        { familyKey: 'Alpha', rating: 4, comment: 'Hero face' },
        { familyKey: 'Beta', rating: 2 },
      ],
      retiredTagSeeds: ['trial'],
    })
    const dest = path.join(source.dataRoot, 'details.cuttlerbackup')
    createBackup(source, { destinationPath: dest })
    saveCatalog(target, {
      version: 1,
      entries: [],
      familyDetails: [{ familyKey: 'Keep', rating: 1, comment: 'old' }],
      retiredTagSeeds: ['licensed'],
    })
    saveCatalog(fontsOnly, {
      version: 1,
      entries: [],
      familyDetails: [{ familyKey: 'Keep', rating: 5, comment: 'stay' }],
      retiredTagSeeds: ['open-source'],
    })

    const report = restoreBackup(target, dest)
    assert.equal(report.failed.length, 0, JSON.stringify(report.failed))
    const restored = loadCatalog(target)
    assert.deepEqual(restored.familyDetails, [
      { familyKey: 'Alpha', rating: 4, comment: 'Hero face' },
      { familyKey: 'Beta', rating: 2 },
    ])
    assert.deepEqual(restored.retiredTagSeeds, ['trial'])
    assert.equal(restored.tags?.some((tag) => tag.seed === 'trial'), false)
    assert.equal(restored.tags?.some((tag) => tag.seed === 'licensed'), true)
    assert.ok(restored.familyTags?.some((row) => row.familyKey === 'Alpha' && row.tagIds.includes('custom-1')))

    const fontsReport = restoreBackup(fontsOnly, dest, { restoreOrganization: false })
    assert.equal(fontsReport.restoreOrganization, false)
    const kept = loadCatalog(fontsOnly)
    assert.deepEqual(kept.familyDetails, [{ familyKey: 'Keep', rating: 5, comment: 'stay' }])
    assert.deepEqual(kept.retiredTagSeeds, ['open-source'])
  } finally {
    cleanup(source, target, fontsOnly)
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

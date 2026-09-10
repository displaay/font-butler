// Opt-in audit diagnostics. These assertions cover the corrected behavior;
// they are kept outside the normal suite because the benchmark is synthetic.
// FONT_BUTLER_TEST=1 npx tsx docs/audits/2026-09-10-repro.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { withService, writeTestFont } from '../../core/test-util.ts'
import { noopFontNative } from '../../core/native.ts'
import { fingerprintFile } from '../../core/fingerprint.ts'
import { closeAllWatchers, refreshSourceStatus } from '../../core/watch.ts'
import { loadCatalog, saveCatalog } from '../../core/catalog.ts'
import { createWatchFolder } from '../../core/folders.ts'
import { importInboxFiles } from '../../core/service-import.ts'

type Service = Parameters<Parameters<typeof withService>[0]>[0]
type Paths = Parameters<Parameters<typeof withService>[0]>[1]

async function fixture(service: Service, paths: Paths, name = 'Audit', style = 'Regular') {
  const source = path.join(paths.dataRoot, 'input', `${name}-${style}.ttf`)
  writeTestFont(source, name, `${name}-${style}`, { style, codePoints: [65, 66] })
  const result = await service.importPaths([source])
  assert.equal(result.errors.length, 0)
  return result.entries[0]!
}

function addFeature(source: string) {
  execFileSync('python3', ['-c', `
from fontTools.ttLib import TTFont
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
font = TTFont(${JSON.stringify(source)})
font['hmtx'].metrics['B'] = (900, 0)
addOpenTypeFeaturesFromString(font, 'languagesystem DFLT dflt; feature ss01 { sub A by B; } ss01;')
font.save(${JSON.stringify(source)})
`], { stdio: 'pipe' })
}

async function check(name: string, fn: () => Promise<unknown>) {
  const detail = await fn()
  console.log(JSON.stringify({ confirmed: name, detail }))
}

await check('Deactivated preview metadata resolves retained bytes', () => withService(async (service, paths) => {
  const original = await fixture(service, paths)
  await service.install(original.id)
  assert.ok(service.previewMeta(original.id).characterSet?.length)
  const parked = await service.deactivate(original.id)
  assert.ok(fs.existsSync(parked.disabledPath!))
  assert.ok(service.fontBytesForEntry(original.id).buffer.length)
  assert.ok(service.previewMeta(original.id).characterSet?.length)
  assert.equal(service.previewGlyph(original.id, 65).name, 'A')
  return { cardBytesAvailable: true, metadataAndGlyphNameAvailable: true }
}))

await check('Adobe-only preview retains access when source is removed', () => withService(async (service, paths) => {
  fs.mkdirSync(paths.adobeFontsDir, { recursive: true })
  const original = await fixture(service, paths)
  const installed = await service.install(original.id, undefined, { destinationId: 'adobe-shared' })
  const adobe = installed.installations!.find(copy => copy.destinationId === 'adobe-shared')!
  assert.ok(fs.existsSync(adobe.path))
  await closeAllWatchers()
  fs.rmSync(original.sourcePath)
  assert.ok(service.fontBytesForEntry(original.id).buffer.length)
  assert.equal(await service.reveal(original.id, 'installed'), adobe.path)
  return { adobeCopyExists: true, fontBytesAvailable: true }
}))

await check('Baking respects a version pinned by an active project', () => withService(async (service, paths) => {
  const original = await fixture(service, paths)
  addFeature(original.sourcePath)
  const installed = await service.install(original.id)
  const project = await service.createProject('Pinned project', [original.id])
  await service.updateProject(project.id, { pin: { assetId: original.id, fingerprint: installed.installedFingerprint } })
  await service.activateProject(project.id)
  assert.equal(service.projectState(project.id), 'active')
  await assert.rejects(service.bakeFeatures(original.id, ['ss01'], 'reinstall'), /Pinned for/)
  assert.equal(service.listCatalog().find(item => item.id === original.id)?.installedFingerprint, installed.installedFingerprint)
  assert.equal(service.projectState(project.id), 'active')
  return { bakeRejected: true, pinnedVersionPreserved: true, projectState: service.projectState(project.id) }
}))

await check('Failed source write rolls back the bake transaction', () => withService(async (service, paths) => {
  const original = await fixture(service, paths)
  addFeature(original.sourcePath)
  const installed = await service.install(original.id)
  const before = fingerprintFile(installed.installedPath!)
  const count = service.listActivity().length
  const copyFile = fs.copyFileSync
  fs.copyFileSync = function (source, destination, mode) {
    if (destination === original.sourcePath) throw new Error('Injected source write failure')
    return copyFile(source, destination, mode)
  }
  try {
    await assert.rejects(service.bakeFeatures(original.id, ['ss01'], 'reinstall'), /Injected source write failure/)
  } finally {
    fs.copyFileSync = copyFile
  }
  assert.equal(fingerprintFile(installed.installedPath!), before)
  assert.equal(fingerprintFile(original.sourcePath), before)
  assert.equal(service.listActivity().length, count)
  return { actionRejected: true, installedBytesRestored: true, sourceUnchanged: true, activityNotRecorded: true }
}))

await check('Batch install reports partial failures in the result and Activity', () => withService(async (service, paths) => {
  const good = await fixture(service, paths, 'AuditGood')
  const missing = await fixture(service, paths, 'AuditMissing')
  await closeAllWatchers()
  fs.rmSync(missing.sourcePath)
  const result = await service.installMany([good.id, missing.id])
  assert.equal(result.length, 1)
  const operation = service.listActivity().find(item => item.action === 'install')!
  assert.equal(operation.outcome, 'partial')
  assert.equal(operation.items.length, 2)
  assert.equal(operation.items.some(item => item.entryId === missing.id && item.outcome === 'failed'), true)
  assert.equal((result as { failed?: number }).failed, 1)
  return { requested: 2, returned: 1, outcome: operation.outcome, missingFailureRecord: true }
}))

await check('Reinstall clears caches once for the batch', async () => {
  let clears = 0
  return withService(async (service, paths) => {
    const one = await fixture(service, paths, 'AuditOne')
    const two = await fixture(service, paths, 'AuditTwo')
    await service.install(one.id)
    await service.install(two.id)
    writeTestFont(one.sourcePath, 'AuditOne', 'AuditOne-Regular', { version: 'Version 2.000' })
    writeTestFont(two.sourcePath, 'AuditTwo', 'AuditTwo-Regular', { version: 'Version 2.000' })
    clears = 0
    await service.reinstallMany([one.id, two.id])
    assert.equal(clears, 1)
    const changedCacheClears = clears
    clears = 0
    await service.reinstallMany([one.id, two.id])
    assert.equal(clears, 0)
    return { fonts: 2, changedCacheClears, unchangedCacheClears: clears }
  }, { native: noopFontNative({ async clearFontCaches() {
    clears++
    return { mac: false, office: false, adobe: false }
  } }) })
})

await check('Undo relink restores the complete previous source state', () => withService(async (service, paths) => {
  const original = await fixture(service, paths)
  const installed = await service.install(original.id)
  const nextSource = path.join(paths.dataRoot, 'next', 'Audit-Regular.ttf')
  writeTestFont(nextSource, 'Audit', 'Audit-Regular', { version: 'Version 2.000', codePoints: [65, 66] })
  await service.applyRelink(original.id, nextSource)
  const operation = service.listActivity().find(item => item.action === 'relink-source')!
  const result = await service.undoOperation(operation.id)
  assert.equal(result.failed, 0)
  const after = service.listCatalog().find(item => item.id === original.id)!
  assert.equal(after.sourcePath, original.sourcePath)
  assert.equal(after.sourceFingerprint, installed.installedFingerprint)
  assert.notEqual(after.updateHold, 'relink-review')
  assert.equal(after.status, 'installed')
  return { originalPathRestored: true, fingerprintRestored: true, updateHold: after.updateHold, status: after.status }
}))

await check('Install as honors the Adobe-only destination', () => withService(async (service, paths) => {
  fs.mkdirSync(paths.adobeFontsDir, { recursive: true })
  await service.updateSettings({ defaultDestination: 'adobe-shared' })
  const original = await fixture(service, paths)
  const regular = await service.install(original.id)
  assert.ok(regular.installations?.some(copy => copy.destinationId === 'adobe-shared'))
  const renamed = await service.install(original.id, 'Renamed Audit', { destinationId: 'adobe-shared' })
  assert.equal(renamed.installedPath, undefined)
  assert.equal(renamed.installations?.some(copy => copy.destinationId === 'adobe-shared') ?? false, true)
  return { requested: 'adobe-shared', actual: 'adobe-shared' }
}))

await check('Same-stamp source replacement is detected across app startup', () => withService(async (service, paths) => {
  const original = await fixture(service, paths)
  const fixed = new Date('2026-01-01T12:00:00Z')
  fs.utimesSync(original.sourcePath, fixed, fixed)
  const installed = await service.install(original.id)
  await closeAllWatchers()
  const before = fs.statSync(original.sourcePath)
  writeTestFont(original.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000', codePoints: [65, 66] })
  assert.equal(fs.statSync(original.sourcePath).size, before.size)
  fs.utimesSync(original.sourcePath, fixed, fixed)
  assert.notEqual(fingerprintFile(original.sourcePath), installed.installedFingerprint)
  await service.init()
  const stale = service.listCatalog().find(item => item.id === original.id)!
  assert.equal(stale.status, 'outdated')
  assert.notEqual(stale.sourceFingerprint, installed.installedFingerprint)
  await refreshSourceStatus(paths, original.sourcePath)
  assert.equal(service.listCatalog().find(item => item.id === original.id)!.status, 'outdated')
  return { afterStartup: stale.status, afterExplicitWatchRefresh: 'outdated' }
}))

await check('Reinstall with unchanged timestamps replaces changed bytes', () => withService(async (service, paths) => {
  const original = await fixture(service, paths)
  const fixed = new Date('2026-01-01T12:00:00Z')
  fs.utimesSync(original.sourcePath, fixed, fixed)
  const installed = await service.install(original.id)
  await closeAllWatchers()
  const size = fs.statSync(original.sourcePath).size
  writeTestFont(original.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000', codePoints: [65, 66] })
  assert.equal(fs.statSync(original.sourcePath).size, size)
  fs.utimesSync(original.sourcePath, fixed, fixed)
  await service.reinstall(original.id)
  assert.notEqual(fingerprintFile(installed.installedPath!), installed.installedFingerprint)
  assert.equal(fingerprintFile(original.sourcePath), fingerprintFile(installed.installedPath!))
  return { actionSucceeded: true, installedBytesReplaced: true }
}))

await check('Live watch imports respect pause and exclusions', () => withService(async (service, paths) => {
  const pausedRoot = path.join(paths.dataRoot, 'paused')
  const excludedRoot = path.join(paths.dataRoot, 'excluded')
  fs.mkdirSync(pausedRoot)
  fs.mkdirSync(excludedRoot)
  const pausedFile = path.join(pausedRoot, 'Paused.ttf')
  const excludedFile = path.join(excludedRoot, 'Skip', 'Excluded.ttf')
  writeTestFont(pausedFile, 'Paused', 'Paused-Regular')
  writeTestFont(excludedFile, 'Excluded', 'Excluded-Regular')
  await service.updateSettings({ folders: [
    createWatchFolder(pausedRoot, { watching: true, paused: true }),
    createWatchFolder(excludedRoot, { watching: true, exclusions: ['Skip'] }),
  ] })
  assert.equal(service.listCatalog().length, 0)
  // Invoke exactly the handler called by the watcher's onBatch callback.
  await importInboxFiles(service, [pausedFile, excludedFile])
  assert.equal(service.listCatalog().length, 0)
  return { initialScanImported: 0, liveHandlerImported: 0 }
}))

// Benchmark only synthetic catalog files and noop native APIs. The timer measures
// how long work prevents other tasks on the same Node event loop from running.
if (process.argv.includes('--benchmark')) {
  for (const count of [100, 500, 1000]) {
    await withService(async (service, paths) => {
      const base = await fixture(service, paths, 'Benchmark')
      await closeAllWatchers()
      const bytes = fs.readFileSync(base.sourcePath)
      saveCatalog(paths, { ...loadCatalog(paths), entries: [] })
      const files = Array.from({ length: count }, (_, index) => {
        const file = path.join(paths.dataRoot, 'batch', `${index}.ttf`)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        // Trailing data gives each otherwise valid fixture distinct bytes.
        fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from(String(index).padStart(8, '0'))]))
        return file
      })
      let catalogBytesWritten = 0
      const writeFile = fs.writeFileSync
      fs.writeFileSync = function (file, data, options) {
        if (String(file).startsWith(paths.catalogPath)) catalogBytesWritten += Buffer.byteLength(data as string)
        return writeFile(file, data, options)
      }
      const start = performance.now()
      const timer = new Promise<number>(resolve => setTimeout(() => resolve(performance.now() - start), 0))
      try {
        const result = await service.importPaths(files)
        const elapsedMs = Math.round(performance.now() - start)
        assert.equal(result.entries.length, count)
        console.log(JSON.stringify({ benchmark: 'bulk import', count, elapsedMs,
          eventLoopDelayMs: Math.round(await timer), catalogBytesWritten,
          finalCatalogBytes: fs.statSync(paths.catalogPath).size }))
      } finally {
        fs.writeFileSync = writeFile
      }
    })
  }
}

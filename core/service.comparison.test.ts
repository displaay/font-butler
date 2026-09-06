import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { COMPARISON_STALE_ERROR } from './comparison.ts'
import { fingerprintFile } from './fingerprint.ts'
import { readRevisionBytes } from './revisions.ts'
import { withService, writeTestFont } from './test-util.ts'

test('install without refresh refuses unreviewed source bytes after comparison capture', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Review.ttf')
    writeTestFont(source, 'Review', 'Review-Regular', { version: 'Version 1.000' })
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const reviewed = fs.readFileSync(installed.installedPath!)
    const capture = await service.captureComparison(installed.id)
    assert.equal(capture.sourceFingerprint, fingerprintFile(source))
    assert.equal(capture.installedFingerprint, fingerprintFile(installed.installedPath!))

    writeTestFont(source, 'Review', 'Review-Regular', { version: 'Version 2.000' })
    const unreviewed = fingerprintFile(source)
    assert.notEqual(unreviewed, capture.sourceFingerprint)

    await assert.rejects(
      () => service.install(installed.id, undefined, { expectedSourceFingerprint: capture.sourceFingerprint }),
      { message: COMPARISON_STALE_ERROR },
    )
    assert.deepEqual(fs.readFileSync(installed.installedPath!), reviewed)
    assert.notEqual(fingerprintFile(installed.installedPath!), unreviewed)
  })
})

test('refresh recaptures and install matches the newly captured source bytes', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Refresh.ttf')
    writeTestFont(source, 'Refresh', 'Refresh-Regular', { version: 'Version 1.000' })
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const first = await service.captureComparison(installed.id)

    writeTestFont(source, 'Refresh', 'Refresh-Regular', { version: 'Version 2.000' })
    const newer = fs.readFileSync(source)
    const refreshed = await service.captureComparison(installed.id)
    assert.notEqual(refreshed.sourceFingerprint, first.sourceFingerprint)
    assert.equal(refreshed.sourceFingerprint, fingerprintFile(source))

    const updated = await service.install(installed.id, undefined, {
      expectedSourceFingerprint: refreshed.sourceFingerprint,
    })
    assert.deepEqual(fs.readFileSync(updated.installedPath!), newer)
    assert.equal(fingerprintFile(updated.installedPath!), refreshed.sourceFingerprint)
  })
})

test('captured comparison pair does not drift when the live source changes', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Frozen.ttf')
    writeTestFont(source, 'Frozen', 'Frozen-Regular', { version: 'Version 1.000' })
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const capture = await service.captureComparison(installed.id)
    const capturedSource = readRevisionBytes(paths, capture.sourceFingerprint)
    const capturedInstalled = capture.installedFingerprint
      ? readRevisionBytes(paths, capture.installedFingerprint)
      : undefined
    assert.ok(capturedSource)
    assert.ok(capturedInstalled)

    writeTestFont(source, 'Frozen', 'Frozen-Regular', { version: 'Version 2.000' })
    const live = service.previewMeta(installed.id, 'source')
    const frozenSource = service.previewMeta(installed.id, 'revision', capture.sourceFingerprint)
    const frozenInstalled = service.previewMeta(
      installed.id,
      'revision',
      capture.installedFingerprint ?? undefined,
    )
    assert.equal(frozenSource.fingerprint, capture.sourceFingerprint)
    assert.equal(frozenInstalled.fingerprint, capture.installedFingerprint)
    assert.notEqual(live.fingerprint, capture.sourceFingerprint)
    assert.deepEqual(readRevisionBytes(paths, capture.sourceFingerprint), capturedSource)
    assert.deepEqual(readRevisionBytes(paths, capture.installedFingerprint!), capturedInstalled)

    const still = await service.captureComparison(installed.id)
    assert.equal(still.sourceFingerprint, live.fingerprint)
    assert.notEqual(still.sourceFingerprint, capture.sourceFingerprint)
  })
})

test('reinstall from a stale comparison capture also refuses newer source bytes', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Update.ttf')
    writeTestFont(source, 'Update', 'Update-Regular', { version: 'Version 1.000' })
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const reviewed = fs.readFileSync(installed.installedPath!)
    const capture = await service.captureComparison(installed.id)
    writeTestFont(source, 'Update', 'Update-Regular', { version: 'Version 2.000' })
    await assert.rejects(
      () => service.reinstall(installed.id, { expectedSourceFingerprint: capture.sourceFingerprint }),
      { message: COMPARISON_STALE_ERROR },
    )
    assert.deepEqual(fs.readFileSync(installed.installedPath!), reviewed)
  })
})

test('install without a captured fingerprint still applies the live source', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Live.ttf')
    writeTestFont(source, 'Live', 'Live-Regular', { version: 'Version 1.000' })
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    writeTestFont(source, 'Live', 'Live-Regular', { version: 'Version 2.000' })
    const live = fs.readFileSync(source)
    const updated = await service.install(installed.id)
    assert.deepEqual(fs.readFileSync(updated.installedPath!), live)
  })
})

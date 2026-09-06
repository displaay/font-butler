import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fingerprintFile } from './fingerprint.ts'
import {
  beginJournal,
  loadIncompleteJournals,
  reconcileMutationJournals,
  withMutationJournal,
} from './journal.ts'
import { noopFontNative, setFontNative } from './native.ts'
import { readRevisionBytes, storeRevision } from './revisions.ts'
import { withService, writeTestFont } from './test-util.ts'

async function importFont(
  service: Parameters<Parameters<typeof withService>[0]>[0],
  paths: Parameters<Parameters<typeof withService>[0]>[1],
  relativePath: string,
  version = 'Version 1.000',
) {
  const source = path.join(paths.dataRoot, relativePath)
  writeTestFont(source, 'Audit', 'Audit-Regular', { version })
  const result = await service.importPaths([source])
  assert.equal(result.errors.length, 0)
  assert.ok(result.entries[0])
  return result.entries[0]
}

test('recovery does not delete an unrelated installed file with the same basename', async () => {
  await withService(async (service, paths) => {
    const first = await importFont(service, paths, 'a/Regular.ttf')
    const installed = await service.install(first.id)
    const other = path.join(paths.dataRoot, 'b/Regular.ttf')
    writeTestFont(other, 'Other', 'Other-Regular')
    const imported = (await service.importPaths([other])).entries[0]!
    beginJournal(paths, { kind: 'install', entries: [imported] })
    await reconcileMutationJournals(paths, noopFontNative())
    assert.equal(fs.existsSync(installed.installedPath!), true)
  })
})

test('a catalog commit failure rolls installed bytes back before clearing its journal', async () => {
  await withService(async (service, paths) => {
    const imported = await importFont(service, paths, 'source/Regular.ttf')
    const installed = await service.install(imported.id)
    const original = fingerprintFile(installed.installedPath!)
    writeTestFont(imported.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    const renameSync = fs.renameSync
    let injected = false
    fs.renameSync = function (from, to) {
      if (to === paths.catalogPath && !injected) {
        injected = true
        throw new Error('Injected catalog save failure')
      }
      return renameSync(from, to)
    }
    try {
      await assert.rejects(service.install(imported.id, undefined, { replace: true }), /Injected/)
    } finally {
      fs.renameSync = renameSync
    }
    assert.equal(fingerprintFile(installed.installedPath!), original)
    assert.equal(service.listCatalog().find((entry) => entry.id === imported.id)?.installedFingerprint, original)
    assert.equal(loadIncompleteJournals(paths).length, 0)
  })
})

test('a journal is retained when immediate rollback cannot be verified', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    const renameSync = fs.renameSync
    fs.renameSync = function (from, to) {
      if (to === paths.catalogPath) throw new Error('Injected rollback save failure')
      return renameSync(from, to)
    }
    try {
      await assert.rejects(
        withMutationJournal(paths, { kind: 'install', entries: [entry] }, async () => {
          throw new Error('Injected mutation failure')
        }),
        /Injected mutation failure/,
      )
    } finally {
      fs.renameSync = renameSync
    }
    assert.equal(loadIncompleteJournals(paths).length, 1)
    assert.equal(loadIncompleteJournals(paths)[0]?.phase, 'failed')
  })
})

test('removing an active project member releases its activation owner', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    const project = await service.createProject('Project', [entry.id])
    assert.equal((await service.activateProject(project.id)).failed, 0)
    await service.updateProject(project.id, { memberIds: [] })
    const current = service.listCatalog().find((item) => item.id === entry.id)!
    assert.equal(current.status, 'deactivated')
    assert.equal(current.activationOwners?.some((owner) => owner.projectId === project.id), false)
  })
})

test('active project pins cannot silently replace one another', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    const first = await service.install(entry.id)
    const versionOne = first.installedFingerprint!
    writeTestFont(entry.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    const second = await service.reinstall(entry.id)
    const versionTwo = second.installedFingerprint!
    const p1 = await service.createProject('P1', [entry.id])
    const p2 = await service.createProject('P2', [entry.id])
    await service.updateProject(p1.id, { pin: { assetId: entry.id, fingerprint: versionOne } })
    await service.updateProject(p2.id, { pin: { assetId: entry.id, fingerprint: versionTwo } })
    assert.equal((await service.activateProject(p1.id)).failed, 0)
    await assert.rejects(service.activateProject(p2.id), /Pinned for P1/)
    assert.equal(service.listCatalog().find((item) => item.id === entry.id)?.installedFingerprint, versionOne)
    assert.equal(service.projectState(p1.id), 'active')
    assert.equal(service.projectState(p2.id), 'inactive')
  })
})

test('undo refuses to remove a font changed by a newer operation', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    await service.install(entry.id)
    const originalInstall = service.listActivity().find((operation) => operation.action === 'install')!
    writeTestFont(entry.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    const updated = await service.reinstall(entry.id)
    const result = await service.undoOperation(originalInstall.id)
    assert.equal(result.failed, 1)
    assert.equal(fs.existsSync(updated.installedPath!), true)
    assert.equal(service.listActivity().find((operation) => operation.id === originalInstall.id)?.undone, false)
  })
})

test('project activation is not offered as an unsupported Undo action', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    const project = await service.createProject('Project', [entry.id])
    const result = await service.activateProject(project.id)
    const operation = service.listActivity().find((item) => item.id === result.operationId)!
    assert.equal(operation.undoable, false)
    await assert.rejects(service.undoOperation(operation.id), /cannot be undone/)
  })
})

test('restoring a deactivated revision keeps its bytes parked', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    await service.install(entry.id)
    writeTestFont(entry.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    await service.reinstall(entry.id)
    await service.deactivate(entry.id)
    const restored = await service.restoreRevision(entry.id)
    assert.equal(restored.status, 'deactivated')
    assert.ok(restored.disabledPath)
    assert.equal(fs.existsSync(restored.disabledPath), true)
    assert.equal(fs.existsSync(restored.installedPath!), false)
  })
})

test('restoring an inactive alternative cannot overwrite its active sibling', async () => {
  await withService(async (service, paths) => {
    const first = await importFont(service, paths, 'a/Regular.ttf')
    await service.install(first.id)
    writeTestFont(first.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    await service.reinstall(first.id)
    await service.deactivate(first.id)
    const second = await importFont(service, paths, 'b/Regular.ttf', 'Version 3.000')
    const installedSecond = await service.install(second.id)
    const currentBytes = fingerprintFile(installedSecond.installedPath!)
    const restored = await service.restoreRevision(first.id)
    assert.equal(restored.status, 'deactivated')
    assert.equal(fingerprintFile(installedSecond.installedPath!), currentBytes)
  })
})

test('revision storage evicts obsolete unpinned blobs after activity pruning', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    await service.install(entry.id)
    for (let version = 2; version <= 4; version += 1) {
      writeTestFont(entry.sourcePath, 'Audit', 'Audit-Regular', { version: `Version ${version}.000` })
      await service.reinstall(entry.id)
    }
    const budget = fs.statSync(entry.sourcePath).size * 2
    await service.updateSettings({ revisionBudgetBytes: budget, activityMaxOperations: 1 })
    service.listActivity()
    const storage = service.revisionStorage()
    assert.ok(storage.usedBytes <= budget)
    assert.ok(storage.evicted.length > 0 || storage.usedBytes <= budget)
  })
})

test('concurrent project activation cannot install two copies of one identity', async () => {
  await withService(async (service, paths) => {
    const first = await importFont(service, paths, 'a/First.ttf')
    const second = await importFont(service, paths, 'b/Second.ttf', 'Version 2.000')
    const p1 = await service.createProject('P1', [first.id])
    const p2 = await service.createProject('P2', [second.id])
    const results = await Promise.all([service.activateProject(p1.id), service.activateProject(p2.id)])
    assert.equal(results.reduce((sum, result) => sum + result.failed, 0), 1)
    assert.equal(
      service.listCatalog().filter((entry) => entry.status === 'installed').length,
      1,
    )
  })
})

test('relink records a source path separately from revision retention', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    await service.install(entry.id)
    const relinked = path.join(paths.dataRoot, 'relinked/Regular.ttf')
    fs.mkdirSync(path.dirname(relinked), { recursive: true })
    fs.copyFileSync(entry.sourcePath, relinked)
    await service.applyRelink(entry.id, relinked)
    assert.doesNotThrow(() => service.listActivity())
    await service.init()
  })
})

test('failed activation restores a parked font without a stray live copy', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    await service.install(entry.id)
    const parked = await service.deactivate(entry.id)
    setFontNative(noopFontNative({
      ensureActivation: async () => ({ ok: false, native: true, error: 'Injected activation failure' }),
    }))
    await assert.rejects(service.activate(entry.id), /Injected activation failure/)
    assert.equal(fs.existsSync(parked.installedPath!), false)
    assert.equal(fs.existsSync(parked.disabledPath!), true)
  })
})

test('revision restore keeps Adobe-only installs at the Adobe destination', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    const first = await service.install(entry.id, undefined, { destinationId: 'adobe-shared' })
    storeRevision(paths, entry.sourcePath)
    writeTestFont(entry.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    await service.reinstall(entry.id)
    const restored = await service.restoreRevision(entry.id, first.installedFingerprint)
    const adobe = restored.installations?.find((copy) => copy.destinationId === 'adobe-shared')
    assert.equal(restored.installedPath, undefined)
    assert.ok(adobe)
    assert.equal(fingerprintFile(adobe.path), first.installedFingerprint)
  })
})

test('restoring a parked revision retains the bytes it overwrites', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    await service.install(entry.id)
    writeTestFont(entry.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    const newer = await service.reinstall(entry.id)
    await service.deactivate(entry.id)
    fs.unlinkSync(entry.sourcePath)
    await service.restoreRevision(entry.id)
    assert.ok(readRevisionBytes(paths, newer.installedFingerprint!))
  })
})

test('pinned project activation restores and activates a parked member', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    const original = await service.install(entry.id)
    writeTestFont(entry.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    await service.reinstall(entry.id)
    await service.deactivate(entry.id)
    const project = await service.createProject('Pinned', [entry.id])
    await service.updateProject(project.id, {
      pin: { assetId: entry.id, fingerprint: original.installedFingerprint },
    })
    assert.equal((await service.activateProject(project.id)).failed, 0)
    assert.equal(service.projectState(project.id), 'active')
  })
})

test('a no-op reinstall is never offered as an Undo action', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    await service.install(entry.id)
    writeTestFont(entry.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    const current = await service.reinstall(entry.id)
    await service.reinstall(entry.id)
    const operation = service.listActivity().find((item) => item.action === 'reinstall')!
    assert.equal(operation.undoable, false)
    assert.equal(service.listCatalog().find((item) => item.id === entry.id)?.installedFingerprint, current.installedFingerprint)
  })
})

test('removing an inactive project does not park an independently installed font', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'source/Automatic.ttf')
    writeTestFont(source, 'Automatic', 'Automatic-Regular')
    await service.updateSettings({ installAfterUpload: true })
    const plan = service.planImport([source])
    const entry = (await service.applyPlan(plan.id)).entries[0]!
    const project = await service.createProject('Inactive', [entry.id])
    await service.deleteProject(project.id)
    assert.equal(service.listCatalog().find((item) => item.id === entry.id)?.status, 'installed')
  })
})

test('removing the final Adobe destination marks the entry uninstalled', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    await service.install(entry.id, undefined, { destinationId: 'adobe-shared' })
    const removed = await service.removeDestinationCopy(entry.id, 'adobe-shared')
    assert.equal(removed.status, 'uninstalled')
  })
})

test('matching import idempotency keys share one queued operation', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'source/Concurrent.ttf')
    writeTestFont(source, 'Concurrent', 'Concurrent-Regular')
    const plan = service.planImport([source])
    const [first, second] = await Promise.all([
      service.applyPlan(plan.id, {}, { idempotencyKey: 'same-request' }),
      service.applyPlan(plan.id, {}, { idempotencyKey: 'same-request' }),
    ])
    assert.equal(first.operationId, second.operationId)
  })
})

test('revision restore retains facts about the actual external source', async () => {
  await withService(async (service, paths) => {
    const entry = await importFont(service, paths, 'source/Regular.ttf')
    await service.install(entry.id)
    writeTestFont(entry.sourcePath, 'Audit', 'Audit-Regular', { version: 'Version 2.000' })
    await service.reinstall(entry.id)
    const sourceFingerprint = fingerprintFile(entry.sourcePath)
    const restored = await service.restoreRevision(entry.id)
    assert.equal(restored.sourceFingerprint, sourceFingerprint)
  })
})

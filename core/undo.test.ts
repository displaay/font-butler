import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fingerprintFile } from './fingerprint.ts'
import { withService, writeTestFont } from './test-util.ts'

test('Undo restores a deactivated font', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'DeactivateUndo.ttf')
    writeTestFont(source, 'DeactivateUndo', 'DeactivateUndo-Regular')
    const imported = await service.importPaths([source])
    await service.install(imported.entries[0]!.id)
    await service.deactivate(imported.entries[0]!.id)
    const operation = service.listActivity().find((item) => item.action === 'deactivate' && item.undoable)
    assert.ok(operation)
    const result = await service.undoOperation(operation.id)
    assert.equal(result.failed, 0)
    const restored = service.listCatalog().find((item) => item.id === imported.entries[0]!.id)!
    assert.equal(restored.status, 'installed')
    assert.equal(service.listActivity().find((item) => item.id === operation.id)?.undone, true)
  })
})

test('Undo parks an activated font again', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'ActivateUndo.ttf')
    writeTestFont(source, 'ActivateUndo', 'ActivateUndo-Regular')
    const imported = await service.importPaths([source])
    await service.install(imported.entries[0]!.id)
    await service.deactivate(imported.entries[0]!.id)
    await service.activate(imported.entries[0]!.id)
    const operation = service.listActivity().find((item) => item.action === 'activate' && item.undoable)
    assert.ok(operation)
    const result = await service.undoOperation(operation.id)
    assert.equal(result.failed, 0)
    assert.equal(service.listCatalog().find((item) => item.id === imported.entries[0]!.id)?.status, 'deactivated')
  })
})

test('Undo of a first install removes the live copy and keeps the library row', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'InstallUndo.ttf')
    writeTestFont(source, 'InstallUndo', 'InstallUndo-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const operation = service.listActivity().find((item) => item.action === 'install' && item.undoable)
    assert.ok(operation)
    const result = await service.undoOperation(operation.id)
    assert.equal(result.failed, 0)
    const after = service.listCatalog().find((item) => item.id === installed.id)!
    assert.equal(after.status, 'uninstalled')
    assert.equal(fs.existsSync(installed.installedPath!), false)
    assert.equal(fs.existsSync(source), true)
  })
})

test('Undo of uninstall restores an Adobe-only copy to Adobe, not macOS', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'AdobeUndo.ttf')
    writeTestFont(source, 'AdobeUndo', 'AdobeUndo-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id, undefined, { destinationId: 'adobe-shared' })
    const adobePath = installed.installations?.find((copy) => copy.destinationId === 'adobe-shared')?.path
    assert.ok(adobePath)
    const original = fingerprintFile(adobePath)
    await service.uninstall(installed.id)
    const operation = service.listActivity().find((item) => item.action === 'uninstall' && item.undoable)
    assert.ok(operation)
    const result = await service.undoOperation(operation.id)
    assert.equal(result.failed, 0)
    const restored = service.listCatalog().find((item) => item.id === installed.id)!
    const adobe = restored.installations?.find((copy) => copy.destinationId === 'adobe-shared')
    assert.ok(adobe)
    assert.equal(fs.existsSync(adobe.path), true)
    assert.equal(fingerprintFile(adobe.path), original)
    assert.equal(
      restored.installations?.some((copy) => copy.destinationId === 'macos' && copy.verification === 'file-present'),
      false,
    )
  })
})

test('Undo of uninstall restores a font that left the library because it had no source', async () => {
  await withService(async (service, paths) => {
    const font = path.join(paths.userFontsDir, 'AdoptedUndo.ttf')
    writeTestFont(font, 'AdoptedUndo', 'AdoptedUndo-Regular')
    await service.init()
    const entry = service.listCatalog().find((item) => item.faces[0]?.familyName === 'AdoptedUndo')
    assert.ok(entry)
    const original = fingerprintFile(font)
    await service.uninstall(entry.id)
    assert.equal(service.listCatalog().some((item) => item.id === entry.id), false)
    const operation = service.listActivity().find((item) => item.action === 'uninstall' && item.undoable)
    assert.ok(operation)
    const result = await service.undoOperation(operation.id)
    assert.equal(result.failed, 0, result.errors.join('; '))
    const restored = service.listCatalog().find((item) => item.id === entry.id)
    assert.ok(restored)
    assert.equal(restored.status, 'installed')
    assert.ok(restored.installedPath && fs.existsSync(restored.installedPath))
    assert.equal(fingerprintFile(restored.installedPath), original)
  })
})

test('Undo of a later install uninstalls instead of restoring a stale earlier revision', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'StaleUndo.ttf')
    writeTestFont(source, 'StaleUndo', 'StaleUndo-Regular')
    const imported = await service.importPaths([source])
    const first = await service.install(imported.entries[0]!.id)
    const v1 = first.installedFingerprint!
    writeTestFont(source, 'StaleUndo', 'StaleUndo-Regular', { version: 'Version 2.000' })
    await service.reinstall(imported.entries[0]!.id)
    await service.uninstall(imported.entries[0]!.id)
    const second = await service.install(imported.entries[0]!.id)
    assert.notEqual(second.installedFingerprint, v1)
    const operation = service.listActivity().find((item) => item.action === 'install' && item.undoable && !item.undone)
    assert.ok(operation)
    const result = await service.undoOperation(operation.id)
    assert.equal(result.failed, 0, result.errors.join('; '))
    const after = service.listCatalog().find((item) => item.id === imported.entries[0]!.id)!
    assert.equal(after.status, 'uninstalled')
    assert.notEqual(after.installedFingerprint, v1)
  })
})

test('deleting the source with uninstall is not offered as Undo', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'DeleteUndo.ttf')
    writeTestFont(source, 'DeleteUndo', 'DeleteUndo-Regular')
    const imported = await service.importPaths([source])
    await service.install(imported.entries[0]!.id)
    await service.uninstall(imported.entries[0]!.id, { deleteSource: true })
    const operation = service.listActivity().find((item) => item.action === 'uninstall')
    assert.equal(operation?.undoable, false)
  })
})

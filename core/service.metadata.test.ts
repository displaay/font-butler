import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { withService, writeTestFont } from './test-util.ts'

test('reinstall refreshes faces from the staged file', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Live.ttf')
    writeTestFont(source, 'Live', 'Live-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    assert.equal(installed.faces[0]?.styleName, 'Regular')
    const beforeUpdatedAt = installed.updatedAt
    const beforeSnapshot = installed.installedSnapshotMtimeMs

    writeTestFont(source, 'Live', 'Live-Bold', { style: 'Bold' })
    const later = Date.now() / 1000 + 2
    fs.utimesSync(source, later, later)
    const updated = await service.reinstall(installed.id)
    assert.equal(updated.faces[0]?.styleName, 'Bold')
    assert.equal(updated.faces[0]?.postscriptName, 'Live-Bold')
    assert.notEqual(updated.updatedAt, beforeUpdatedAt)
    assert.notEqual(updated.installedSnapshotMtimeMs, beforeSnapshot)
  })
})

test('native activation failure does not persist a successful deactivate', async () => {
  const { noopFontNative, setFontNative } = await import('./native.ts')
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'StayOn.ttf')
    writeTestFont(source, 'StayOn', 'StayOn-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    const calls: string[] = []
    setFontNative(
      noopFontNative({
        async unregisterFont() {
          calls.push('unregister')
          return { ok: false, native: true, error: 'Core Text refused deactivation.' }
        },
        async setFontEnabled(_filePath, enabled) {
          calls.push(enabled ? 'enable' : 'disable')
          return { ok: true, native: false }
        },
      }),
    )
    await assert.rejects(() => service.deactivate(installed.id), /Core Text refused/)
    assert.equal(calls.includes('unregister'), true)
    assert.equal(calls.includes('disable'), false)
    const latest = service.listCatalog().find((entry) => entry.id === installed.id)
    assert.equal(latest?.status, 'installed')
  })
})

test('deactivating a registered font unregisters that file and does not disable by name', async () => {
  const { noopFontNative } = await import('./native.ts')
  const calls: string[] = []
  await withService(
    async (service, paths) => {
      await service.init()
      const source = path.join(paths.dataRoot, 'StillOn.ttf')
      writeTestFont(source, 'StillOn', 'StillOn-Regular')
      const imported = await service.importPaths([source])
      const installed = await service.install(imported.entries[0].id)
      calls.length = 0
      const parked = await service.deactivate(installed.id)
      assert.equal(parked.status, 'deactivated')
      assert.equal(fs.existsSync(installed.installedPath!), false)
      assert.equal(fs.existsSync(parked.disabledPath!), true)
      assert.deepEqual(calls, [`unregister:${installed.installedPath}`])
    },
    {
      native: noopFontNative({
        async unregisterFont(filePath) {
          calls.push(`unregister:${filePath}`)
          return { ok: true, native: true }
        },
        async setFontEnabled(filePath, enabled) {
          calls.push(`set:${filePath}:${enabled ? 1 : 0}`)
          return { ok: true, native: true }
        },
        async fontActivationStates(filePaths) {
          const states: Record<string, boolean> = {}
          for (const filePath of filePaths) states[filePath] = true
          return { ok: true, native: true, states }
        },
      }),
    },
  )
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { FontButlerService } from './service.ts'
import { withService, writeTestFont } from './test-util.ts'
import { closeAllWatchers } from './watch.ts'

test('deactivating two Same.ttf computer fonts keeps both and restores them after restart', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const first = path.join(paths.computerFontsDir, 'One', 'Same.ttf')
    const second = path.join(paths.computerFontsDir, 'Two', 'Same.ttf')
    writeTestFont(first, 'Same', 'Same-Regular')
    writeTestFont(second, 'Same', 'Same-Bold', { style: 'Bold' })
    const bytesA = fs.readFileSync(first)
    const bytesB = fs.readFileSync(second)

    await service.deactivateSystem(first)
    await service.deactivateSystem(second)
    assert.equal(fs.existsSync(first), false)
    assert.equal(fs.existsSync(second), false)

    const deactivated = service.listCatalog().filter((entry) => entry.status === 'deactivated')
    assert.equal(deactivated.length, 2)
    const disabledPaths = deactivated.map((entry) => entry.disabledPath).filter(Boolean)
    assert.equal(new Set(disabledPaths).size, 2)
    assert.ok(disabledPaths.every((filePath) => filePath && fs.existsSync(filePath)))

    const faces = service.listSystem().filter((face) => face.deactivated)
    assert.equal(faces.length, 2)
    assert.ok(faces.every((face) => face.managedId))

    service.dispose()
    await closeAllWatchers()
    const restarted = new FontButlerService(paths)
    try {
      await restarted.init()
      const afterRestart = restarted.listCatalog().filter((entry) => entry.status === 'deactivated')
      assert.equal(afterRestart.length, 2)
      assert.equal(restarted.listSystem().filter((face) => face.deactivated).length, 2)

      for (const entry of afterRestart) {
        await restarted.activate(entry.id)
      }
      assert.equal(fs.existsSync(first), true)
      assert.equal(fs.existsSync(second), true)
      assert.deepEqual(fs.readFileSync(first), bytesA)
      assert.deepEqual(fs.readFileSync(second), bytesB)
      assert.equal(restarted.listCatalog().filter((entry) => entry.status === 'deactivated').length, 0)
    } finally {
      restarted.dispose()
      await closeAllWatchers()
    }
  })
})

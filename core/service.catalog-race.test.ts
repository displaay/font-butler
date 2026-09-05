import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { noopFontNative } from './native.ts'
import { withService, writeTestFont } from './test-util.ts'
import { refreshSourceStatus } from './watch.ts'

test('source changes during a delayed deactivate stay outdated', async () => {
  let releaseA: (() => void) | undefined
  const holdA = new Promise<void>((resolve) => {
    releaseA = resolve
  })
  await withService(
    async (service, paths) => {
      await service.init()
      const sourceA = path.join(paths.dataRoot, 'A.ttf')
      const sourceB = path.join(paths.dataRoot, 'B.ttf')
      writeTestFont(sourceA, 'Alpha', 'Alpha-Regular')
      writeTestFont(sourceB, 'Bravo', 'Bravo-Regular')
      const imported = await service.importPaths([sourceA, sourceB])
      const entryA = imported.entries.find((entry) => entry.faces[0]?.familyName === 'Alpha')
      const entryB = imported.entries.find((entry) => entry.faces[0]?.familyName === 'Bravo')
      assert.ok(entryA && entryB)
      await service.install(entryA.id)
      await service.install(entryB.id)

      const deactivate = service.deactivate(entryA.id)
      await new Promise((resolve) => setTimeout(resolve, 20))
      writeTestFont(sourceB, 'Bravo', 'Bravo-Regular', { version: 'Version 2.000' })
      const refresh = refreshSourceStatus(paths, sourceB)
      releaseA?.()
      await deactivate
      await refresh

      const latestB = service.listCatalog().find((entry) => entry.id === entryB.id)
      assert.ok(latestB)
      assert.equal(latestB.status, 'outdated')
      const latestA = service.listCatalog().find((entry) => entry.id === entryA.id)
      assert.equal(latestA?.status, 'deactivated')
    },
    {
      native: noopFontNative({
        async setFontEnabled(filePath, enabled) {
          if (!enabled && path.basename(filePath) === 'A.ttf') {
            await holdA
          }
          return { ok: true, native: false }
        },
      }),
    },
  )
})

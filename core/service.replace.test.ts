import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { noopFontNative, setFontNative } from './native.ts'
import { withService, writeTestFont } from './test-util.ts'

test('reinstall with a missing source keeps the installed bytes', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Keep.ttf')
    writeTestFont(source, 'KeepFace', 'KeepFace-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    const bytes = fs.readFileSync(installed.installedPath!)
    fs.rmSync(source)
    await assert.rejects(() => service.reinstall(installed.id), /source file is missing/)
    assert.equal(fs.existsSync(installed.installedPath!), true)
    assert.deepEqual(fs.readFileSync(installed.installedPath!), bytes)
    assert.equal(service.listCatalog()[0]?.status, 'installed')
  })
})

test('reinstall with a corrupt source keeps the installed bytes', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Corrupt.ttf')
    writeTestFont(source, 'CorruptFace', 'CorruptFace-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0].id)
    const bytes = fs.readFileSync(installed.installedPath!)
    fs.writeFileSync(source, 'not a font')
    await assert.rejects(() => service.reinstall(installed.id), /./)
    assert.equal(fs.existsSync(installed.installedPath!), true)
    assert.deepEqual(fs.readFileSync(installed.installedPath!), bytes)
    assert.equal(service.listCatalog()[0]?.status, 'installed')
  })
})

test('failed format replacement restores the previous installed bytes', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const ttf = path.join(paths.dataRoot, 'Face.ttf')
    const otf = path.join(paths.dataRoot, 'Face.otf')
    writeTestFont(ttf, 'Face', 'Face-Regular')
    writeTestFont(otf, 'Face', 'Face-Regular', { format: 'otf' })
    const ttfEntry = (await service.importPaths([ttf])).entries[0]
    const installed = await service.install(ttfEntry.id)
    const ttfBytes = fs.readFileSync(installed.installedPath!)
    const otfEntry = (await service.importPaths([otf])).entries[0]
    assert.notEqual(otfEntry.id, ttfEntry.id)
    setFontNative(
      noopFontNative({
        async setFontEnabled(filePath, enabled) {
          if (enabled && filePath.toLowerCase().endsWith('.otf')) {
            return { ok: false, native: true, error: 'OTF refused' }
          }
          return { ok: true, native: false }
        },
      }),
    )
    await assert.rejects(
      () => service.install(otfEntry.id, undefined, { replace: true }),
      /OTF refused/,
    )
    assert.equal(fs.existsSync(installed.installedPath!), true)
    assert.deepEqual(fs.readFileSync(installed.installedPath!), ttfBytes)
    assert.equal(service.listCatalog().find((entry) => entry.id === ttfEntry.id)?.status, 'installed')
  })
})

test('activation failure during reinstall restores the previous bytes', async () => {
  const native = noopFontNative({
    async setFontEnabled(filePath, enabled) {
      if (enabled && filePath.includes('FailFace')) {
        return { ok: false, native: true, error: 'Core Text refused the font.' }
      }
      return { ok: true, native: false }
    },
  })
  await withService(
    async (service, paths) => {
      await service.init()
      const source = path.join(paths.dataRoot, 'FailFace.ttf')
      writeTestFont(source, 'FailFace', 'FailFace-Regular')
      const imported = await service.importPaths([source])
      setFontNative(noopFontNative())
      const installed = await service.install(imported.entries[0].id)
      const bytes = fs.readFileSync(installed.installedPath!)
      writeTestFont(source, 'FailFace', 'FailFace-Regular')
      setFontNative(native)
      await assert.rejects(() => service.reinstall(installed.id), /Core Text refused/)
      assert.deepEqual(fs.readFileSync(installed.installedPath!), bytes)
      assert.equal(service.listCatalog()[0]?.status, 'installed')
    },
    { native: noopFontNative() },
  )
})

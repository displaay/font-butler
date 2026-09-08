import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { formatConflictMessage } from './formats.ts'
import { withService, writeTestFont } from './test-util.ts'

test('TTF and CFF OTF with the same face stay separate until replace is chosen', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const ttf = path.join(paths.dataRoot, 'Face.ttf')
    const otf = path.join(paths.dataRoot, 'Face.otf')
    writeTestFont(ttf, 'Face', 'Face-Regular')
    writeTestFont(otf, 'Face', 'Face-Regular', { format: 'otf' })
    const ttfEntry = (await service.importPaths([ttf])).entries[0]
    const installed = await service.install(ttfEntry.id)
    const ttfBytes = fs.readFileSync(installed.installedPath!)
    const ttfPath = installed.installedPath!
    assert.equal(path.extname(ttfPath).toLowerCase(), '.ttf')

    const imported = await service.importPaths([otf])
    assert.equal(imported.entries.length, 1)
    const otfEntry = imported.entries[0]
    assert.notEqual(otfEntry.id, ttfEntry.id)
    assert.equal(otfEntry.format, 'otf')
    assert.equal(service.listCatalog().length, 2)
    assert.deepEqual(fs.readFileSync(ttfPath), ttfBytes)

    await assert.rejects(
      () => service.install(otfEntry.id),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.message, formatConflictMessage(otfEntry, installed))
        return true
      },
    )
    assert.deepEqual(fs.readFileSync(ttfPath), ttfBytes)
    assert.equal(path.extname(ttfPath).toLowerCase(), '.ttf')

    const replaced = await service.install(otfEntry.id, undefined, { replace: true })
    assert.equal(path.extname(replaced.installedPath ?? '').toLowerCase(), '.otf')
    assert.equal(replaced.format, 'otf')
    assert.notEqual(replaced.installedPath, ttfPath)
    assert.equal(fs.existsSync(ttfPath), false)
  })
})

test('replace swap also replaces the Adobe testing-folder copy', async () => {
  await withService(async (service, paths) => {
    await service.init()
    await service.updateSettings({ defaultDestination: 'macos-and-adobe' })
    const ttf = path.join(paths.dataRoot, 'Face.ttf')
    const otf = path.join(paths.dataRoot, 'Face.otf')
    writeTestFont(ttf, 'Face', 'Face-Regular')
    writeTestFont(otf, 'Face', 'Face-Regular', { format: 'otf' })
    const ttfEntry = (await service.importPaths([ttf])).entries[0]!
    const installed = await service.install(ttfEntry.id)
    const adobePath = installed.installations?.find((copy) => copy.destinationId === 'adobe-shared')?.path
    assert.ok(adobePath && fs.existsSync(adobePath))
    assert.equal(path.extname(adobePath).toLowerCase(), '.ttf')

    const otfEntry = (await service.importPaths([otf])).entries[0]!
    const replaced = await service.install(otfEntry.id, undefined, {
      replace: true,
      destinationIds: ['macos', 'adobe-shared'],
    })
    assert.equal(replaced.format, 'otf')
    const newAdobe = replaced.installations?.find((copy) => copy.destinationId === 'adobe-shared')?.path
    assert.ok(newAdobe && fs.existsSync(newAdobe))
    assert.equal(path.extname(newAdobe).toLowerCase(), '.otf')
    assert.equal(fs.existsSync(adobePath), false)
    const adobeLive = fs.existsSync(paths.adobeFontsDir)
      ? fs.readdirSync(paths.adobeFontsDir).filter((name) => !name.startsWith('.'))
      : []
    assert.equal(adobeLive.length, 1)
    assert.equal(path.extname(adobeLive[0]!).toLowerCase(), '.otf')
  })
})

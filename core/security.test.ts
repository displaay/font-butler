import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { withService, writeTestFont } from './test-util.ts'

test('fontBytesForPath refuses a non-font file inside an allowed root', async () => {
  await withService(async (service, paths) => {
    await service.init()
    fs.mkdirSync(paths.userFontsDir, { recursive: true })
    const secret = path.join(paths.userFontsDir, 'notes.txt')
    fs.writeFileSync(secret, 'not a font')
    assert.throws(() => service.fontBytesForPath(secret), /not readable/)
  })
})

test('fontBytesForPath refuses a symlink that escapes an allowed root', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const outside = path.join(paths.dataRoot, 'outside')
    fs.mkdirSync(outside)
    const secret = path.join(outside, 'Secret.ttf')
    writeTestFont(secret, 'Secret', 'Secret-Regular')
    fs.mkdirSync(paths.userFontsDir, { recursive: true })
    const link = path.join(paths.userFontsDir, 'Trap.ttf')
    fs.symlinkSync(secret, link)
    assert.throws(() => service.fontBytesForPath(link), /not readable/)
  })
})

test('fontBytesForPath serves a real font under an allowed root', async () => {
  await withService(async (service, paths) => {
    await service.init()
    fs.mkdirSync(paths.userFontsDir, { recursive: true })
    const font = path.join(paths.userFontsDir, 'Ok.ttf')
    writeTestFont(font, 'Readable', 'Readable-Regular')
    const bytes = service.fontBytesForPath(font)
    assert.equal(bytes.filename, 'Ok.ttf')
    assert.equal(bytes.mime, 'font/ttf')
    assert.ok(bytes.buffer.length > 0)
  })
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mock, test } from 'node:test'
import {
  defaultTestInstallDir,
  deleteTestInstallFiles,
  resolveTestInstallFile,
  scanTestInstallDir,
  testInstallId,
  TEST_INSTALL_APP_NAME,
} from './test-install.ts'
import { withService, writeTestFont } from './test-util.ts'

test('default test install dir is the Font Builder session folder', () => {
  const dir = defaultTestInstallDir('/Users/example')
  assert.equal(
    dir,
    path.join('/Users/example', 'Library', 'Application Support', TEST_INSTALL_APP_NAME, 'TestInstall'),
  )
})

test('test install ids stay stable for a path', () => {
  const file = '/tmp/TestInstall/Family-Regular.otf'
  assert.equal(testInstallId(file), testInstallId(file))
  assert.notEqual(testInstallId(file), testInstallId('/tmp/TestInstall/Family-Bold.otf'))
})

test('scan ignores non-fonts and refuses paths that escape the folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-test-install-'))
  const outside = path.join(root, 'outside')
  const inside = path.join(root, 'TestInstall')
  fs.mkdirSync(outside)
  fs.mkdirSync(inside)
  fs.writeFileSync(path.join(inside, 'notes.txt'), 'nope')
  fs.writeFileSync(path.join(outside, 'Secret.otf'), 'not-a-font')
  fs.symlinkSync(path.join(outside, 'Secret.otf'), path.join(inside, 'Secret.otf'))

  assert.equal(resolveTestInstallFile(path.join(inside, 'Secret.otf'), inside), null)
  assert.equal(resolveTestInstallFile(path.join(outside, 'Secret.otf'), inside), null)
  assert.deepEqual(scanTestInstallDir(inside), [])
  assert.deepEqual(deleteTestInstallFiles(inside, [path.join(outside, 'Secret.otf')]), [])
  assert.equal(fs.existsSync(path.join(outside, 'Secret.otf')), true)

  fs.writeFileSync(path.join(inside, 'Broken.otf'), 'not-a-font')
  assert.deepEqual(scanTestInstallDir(inside), [])
  assert.deepEqual(deleteTestInstallFiles(inside, [path.join(inside, 'Broken.otf')]), [
    path.join(inside, 'Broken.otf'),
  ])
  assert.equal(fs.existsSync(path.join(inside, 'Broken.otf')), false)
})

test('preview meta and glyph read a test install that is not in the library', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-ti-preview-'))
  const homedir = mock.method(os, 'homedir', () => home)
  try {
    const dir = defaultTestInstallDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'Session-Regular.otf')
    writeTestFont(file, 'Session', 'Session-Regular', { format: 'otf', codePoints: [65] })
    await withService(async (service) => {
      const fonts = service.listTestInstalls()
      assert.equal(fonts.length, 1)
      const id = fonts[0]!.id
      assert.equal(id, testInstallId(file))
      assert.equal(service.listCatalog().some((entry) => entry.id === id), false)

      const meta = service.previewMeta(id)
      assert.equal(meta.entryId, id)
      assert.equal(meta.which, 'installed')
      assert.equal(meta.faces[0]?.familyName, 'Session')
      assert.equal(meta.faces[0]?.postscriptName, 'Session-Regular')
      assert.equal(meta.characterSet?.includes(65), true)

      const glyph = service.previewGlyph(id, 65)
      assert.equal(glyph.code, 65)
      assert.equal(glyph.name, 'A')

      const bytes = service.fontBytesForRevision(id)
      assert.equal(bytes.filename, 'Session-Regular.otf')
      assert.ok(bytes.buffer.length > 0)

      assert.throws(() => service.previewMeta('not-a-test-install'), /Font is not in the library/)
      assert.throws(() => service.previewGlyph('not-a-test-install', 65), /Font is not in the library/)

      fs.unlinkSync(file)
      assert.throws(() => service.previewMeta(id), /not readable/)
      assert.throws(() => service.previewGlyph(id, 65), /not readable/)
    })
  } finally {
    homedir.mock.restore()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

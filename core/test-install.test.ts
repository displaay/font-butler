import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mock, test } from 'node:test'
import {
  defaultTestInstallDir,
  deleteTestInstallFiles,
  glyphsTestInstallDirs,
  isGlyphsTestInstallDir,
  resolveTestInstallFile,
  resolveTestInstallFileInDirs,
  scanTestInstallDir,
  scanTestInstallDirs,
  testInstallDirs,
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

test('glyphs test installs use the Glyphs 3 and Glyphs 4 Temp folders', () => {
  const home = '/Users/example'
  const glyphs = glyphsTestInstallDirs(home)
  assert.deepEqual(glyphs, [
    path.join(home, 'Library', 'Application Support', 'Glyphs 3', 'Temp'),
    path.join(home, 'Library', 'Application Support', 'Glyphs 4', 'Temp'),
  ])
  assert.deepEqual(testInstallDirs(home), [defaultTestInstallDir(home), ...glyphs])
  assert.equal(isGlyphsTestInstallDir(glyphs[1]!, home), true)
  assert.equal(isGlyphsTestInstallDir(defaultTestInstallDir(home), home), false)
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

  const broken = path.join(inside, 'Broken.otf')
  fs.writeFileSync(broken, 'not-a-font')
  assert.deepEqual(scanTestInstallDir(inside), [])
  const brokenReal = fs.realpathSync(broken)
  assert.deepEqual(deleteTestInstallFiles(inside, [broken]), [brokenReal])
  assert.equal(fs.existsSync(path.join(inside, 'Broken.otf')), false)
})

test('glyphs temp lists only session test installs, not full-export leftovers', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-ti-glyphs-'))
  const homedir = mock.method(os, 'homedir', () => home)
  try {
    const builder = defaultTestInstallDir()
    const [glyphs3, glyphs4] = glyphsTestInstallDirs()
    const outside = path.join(home, 'outside')
    fs.mkdirSync(builder, { recursive: true })
    fs.mkdirSync(glyphs3, { recursive: true })
    fs.mkdirSync(path.join(glyphs3, 'Project'), { recursive: true })
    fs.mkdirSync(glyphs4, { recursive: true })
    fs.mkdirSync(outside, { recursive: true })
    const builderFile = path.join(builder, 'Builder-Regular.otf')
    const glyphs3File = path.join(glyphs3, 'Glyphs-Regular.otf')
    const exportFile = path.join(glyphs4, 'Exported-Regular.otf')
    const nestedFile = path.join(glyphs3, 'Project', 'Nested.otf')
    writeTestFont(builderFile, 'Builder', 'Builder-Regular', { format: 'otf', codePoints: [65] })
    fs.copyFileSync(builderFile, glyphs3File)
    fs.copyFileSync(builderFile, exportFile)
    fs.copyFileSync(builderFile, nestedFile)
    fs.writeFileSync(path.join(outside, 'Secret.otf'), 'not-a-font')
    fs.symlinkSync(path.join(outside, 'Secret.otf'), path.join(glyphs3, 'Secret.otf'))

    const glyphs3Real = fs.realpathSync(glyphs3File)
    const builderReal = fs.realpathSync(builderFile)
    const session = new Set([glyphs3Real])
    const isSessionFont = (filePath: string) => session.has(filePath)
    const scanned = scanTestInstallDirs(testInstallDirs(), { isSessionFont })
    assert.deepEqual(scanned.map((font) => font.path).sort(), [builderReal, glyphs3Real].sort())
    assert.equal(scanned.some((font) => font.path === exportFile), false)
    assert.equal(scanned.some((font) => font.path === nestedFile), false)
    assert.equal(resolveTestInstallFile(exportFile, glyphs4, { isSessionFont }), null)
    assert.equal(resolveTestInstallFile(glyphs3File, glyphs3, { isSessionFont }), glyphs3Real)
    assert.equal(resolveTestInstallFile(path.join(glyphs3, 'Secret.otf'), glyphs3, { isSessionFont }), null)
    assert.equal(resolveTestInstallFileInDirs(path.join(outside, 'Secret.otf'), testInstallDirs(), { isSessionFont }), null)
    assert.deepEqual(deleteTestInstallFiles(glyphs4, [exportFile], { isSessionFont }), [])
    assert.equal(fs.existsSync(exportFile), true)
    assert.equal(testInstallId(glyphs3File), testInstallId(glyphs3File))
    assert.notEqual(testInstallId(glyphs3File), testInstallId(builderFile))

    await withService(async (service) => {
      const fonts = service.listTestInstalls()
      assert.deepEqual(
        fonts.map((font) => font.path),
        [builderReal],
      )
      assert.equal(service.listCatalog().length, 0)
      const installed = fonts[0]
      assert.ok(installed)
      const meta = service.previewMeta(installed.id)
      assert.equal(meta.entryId, installed.id)
      assert.equal(meta.faces[0]?.postscriptName, 'Builder-Regular')
      assert.equal(service.previewGlyph(installed.id, 65).name, 'A')

      assert.throws(() => service.uninstallTestInstalls([exportFile]), /not test installs/)
      assert.equal(fs.existsSync(exportFile), true)
      assert.equal(fs.existsSync(glyphs3File), true)

      const remaining = service.uninstallTestInstalls([builderFile])
      assert.equal(remaining.some((font) => font.path === builderFile), false)
      assert.equal(fs.existsSync(builderFile), false)
      assert.equal(fs.existsSync(exportFile), true)
      assert.equal(fs.existsSync(nestedFile), true)
      assert.throws(() => service.uninstallTestInstalls([path.join(outside, 'Secret.otf')]), /not test installs/)
    })

    assert.deepEqual(deleteTestInstallFiles(glyphs3, [glyphs3File], { isSessionFont: () => true }), [glyphs3Real])
    assert.equal(fs.existsSync(glyphs3File), false)
    assert.equal(fs.existsSync(exportFile), true)
  } finally {
    homedir.mock.restore()
    fs.rmSync(home, { recursive: true, force: true })
  }
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
      assert.equal(id, testInstallId(fs.realpathSync(file)))
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

      const bytes = await service.fontBytesForRevision(id)
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

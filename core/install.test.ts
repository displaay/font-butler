import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { InstalledFontKept } from './caches.ts'
import { commitInstalledFile } from './install.ts'
import { noopFontNative } from './native.ts'
import { ATOMIC_FONT_TEMP_SUFFIX, replaceFontFileAtomically } from './user-fonts.ts'

test('commitInstalledFile does not unregister a brand-new destination', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-install-'))
  const dest = path.join(root, 'Family.ttf')
  const stagedPath = path.join(root, 'staged.ttf')
  const rollbackDir = path.join(root, 'rollback')
  fs.writeFileSync(stagedPath, 'new-bytes')
  const calls: string[] = []
  const native = noopFontNative({
    async unregisterFont(filePath) {
      calls.push(`unregister:${filePath}`)
      return { ok: true, native: true }
    },
    async ensureActivation(filePath, enabled) {
      calls.push(`ensure:${filePath}:${enabled ? '1' : '0'}`)
      return { ok: true, native: true }
    },
  })
  try {
    await commitInstalledFile({ dest, stagedPath, rollbackDir, native })
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new-bytes')
    assert.deepEqual(calls, [`ensure:${dest}:1`])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('commitInstalledFile unregisters an existing destination before overwriting', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-install-'))
  const dest = path.join(root, 'Family.ttf')
  const stagedPath = path.join(root, 'staged.ttf')
  const rollbackDir = path.join(root, 'rollback')
  fs.writeFileSync(dest, 'old-bytes')
  fs.writeFileSync(stagedPath, 'new-bytes')
  const calls: string[] = []
  const native = noopFontNative({
    async unregisterFont(filePath) {
      calls.push(`unregister:${filePath}`)
      return { ok: true, native: true }
    },
    async ensureActivation(filePath, enabled) {
      calls.push(`ensure:${filePath}:${enabled ? '1' : '0'}`)
      return { ok: true, native: true }
    },
  })
  try {
    await commitInstalledFile({ dest, stagedPath, rollbackDir, native })
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new-bytes')
    assert.deepEqual(calls, [`unregister:${dest}`, `ensure:${dest}:1`])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('commitInstalledFile updates a user font without register or unregister and changes the inode', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-user-font-'))
  const fonts = path.join(root, 'Library', 'Fonts')
  const dest = path.join(fonts, 'Family.ttf')
  const stagedPath = path.join(root, 'staged.ttf')
  const rollbackDir = path.join(root, 'rollback')
  const logFile = path.join(root, 'main.log')
  const previousFonts = process.env.FONT_BUTLER_USER_FONTS_DIR
  const previousLog = process.env.FONT_BUTLER_LOG
  process.env.FONT_BUTLER_USER_FONTS_DIR = fonts
  process.env.FONT_BUTLER_LOG = logFile
  fs.mkdirSync(fonts, { recursive: true })
  fs.writeFileSync(dest, 'old-bytes')
  fs.writeFileSync(stagedPath, 'new-bytes')
  const before = fs.statSync(dest).ino
  const calls: string[] = []
  const native = noopFontNative({
    async registerFont(filePath) {
      calls.push(`register:${filePath}`)
      return { ok: true, native: true }
    },
    async unregisterFont(filePath) {
      calls.push(`unregister:${filePath}`)
      return { ok: true, native: true }
    },
    async ensureActivation(filePath, enabled) {
      calls.push(`ensure:${filePath}:${enabled ? '1' : '0'}`)
      return { ok: true, native: true }
    },
  })
  try {
    await commitInstalledFile({ dest, stagedPath, rollbackDir, native })
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new-bytes')
    assert.notEqual(fs.statSync(dest).ino, before)
    assert.deepEqual(calls, [])
    assert.deepEqual(
      fs.readdirSync(fonts).filter((name) => name.includes(ATOMIC_FONT_TEMP_SUFFIX.slice(1))),
      [],
    )
    const log = fs.readFileSync(logFile, 'utf8')
    assert.match(log, /\[install {5}\].*user-font update/)
    assert.match(log, /\[register {4}\].*skip register/)
    assert.match(log, /\[verify {6}\].*skip/)
  } finally {
    if (previousFonts === undefined) delete process.env.FONT_BUTLER_USER_FONTS_DIR
    else process.env.FONT_BUTLER_USER_FONTS_DIR = previousFonts
    if (previousLog === undefined) delete process.env.FONT_BUTLER_LOG
    else process.env.FONT_BUTLER_LOG = previousLog
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a failed user-font check keeps the new bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-keep-'))
  const fonts = path.join(root, 'Library', 'Fonts')
  const dest = path.join(fonts, 'Family.ttf')
  const stagedPath = path.join(root, 'staged.ttf')
  const rollbackDir = path.join(root, 'rollback')
  const previousFonts = process.env.FONT_BUTLER_USER_FONTS_DIR
  process.env.FONT_BUTLER_USER_FONTS_DIR = fonts
  fs.mkdirSync(fonts, { recursive: true })
  fs.writeFileSync(dest, 'old-bytes')
  fs.writeFileSync(stagedPath, 'new-bytes')
  try {
    const warning = await commitInstalledFile({
      dest,
      stagedPath,
      rollbackDir,
      native: noopFontNative(),
      activate: async () => {
        throw new InstalledFontKept('Family is not visible to other apps yet')
      },
    })
    assert.match(warning ?? '', /not visible to other apps yet/)
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new-bytes')
    assert.deepEqual(
      fs.readdirSync(fonts).filter((name) => name.includes('fontbutler-tmp')),
      [],
    )
  } finally {
    if (previousFonts === undefined) delete process.env.FONT_BUTLER_USER_FONTS_DIR
    else process.env.FONT_BUTLER_USER_FONTS_DIR = previousFonts
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a failed check on a registered path rolls the previous bytes back', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-rollback-'))
  const dest = path.join(root, 'Family.ttf')
  const stagedPath = path.join(root, 'staged.ttf')
  const rollbackDir = path.join(root, 'rollback')
  fs.writeFileSync(dest, 'old-bytes')
  fs.writeFileSync(stagedPath, 'new-bytes')
  try {
    await assert.rejects(
      () =>
        commitInstalledFile({
          dest,
          stagedPath,
          rollbackDir,
          native: noopFontNative(),
          activate: async () => {
            throw new Error('Could not register the font (fail:-50).')
          },
        }),
      /fail:-50/,
    )
    assert.equal(fs.readFileSync(dest, 'utf8'), 'old-bytes')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a failed copy leaves no fontbutler temp file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-temp-'))
  const staging = path.join(root, 'staging')
  const fonts = path.join(root, 'Fonts')
  fs.mkdirSync(staging, { recursive: true })
  fs.mkdirSync(fonts, { recursive: true })
  const missing = path.join(staging, 'missing.ttf')
  const dest = path.join(fonts, 'Family.ttf')
  try {
    await assert.rejects(() => replaceFontFileAtomically(missing, dest))
    const leftovers = [staging, fonts].flatMap((dir) =>
      fs.readdirSync(dir).filter((name) => name.includes(ATOMIC_FONT_TEMP_SUFFIX.slice(1))),
    )
    assert.deepEqual(leftovers, [])
    assert.equal(fs.existsSync(dest), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('replaceFontFileAtomically puts the temp in the staging directory on the same volume', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-stage-'))
  const staging = path.join(root, 'staging')
  const fonts = path.join(root, 'Fonts')
  fs.mkdirSync(staging, { recursive: true })
  fs.mkdirSync(fonts, { recursive: true })
  const source = path.join(staging, 'staged.ttf')
  const dest = path.join(fonts, 'Family.ttf')
  fs.writeFileSync(source, 'new-bytes')
  const copies: string[] = []
  const original = fs.promises.copyFile
  fs.promises.copyFile = async (from, to, mode) => {
    copies.push(String(to))
    return original.call(fs.promises, from, to, mode)
  }
  try {
    await replaceFontFileAtomically(source, dest)
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new-bytes')
    assert.ok(copies.some((item) => item.startsWith(staging) && item.endsWith(ATOMIC_FONT_TEMP_SUFFIX)))
    assert.deepEqual(
      fs.readdirSync(staging).filter((name) => name.includes('fontbutler-tmp')),
      [],
    )
  } finally {
    fs.promises.copyFile = original
    fs.rmSync(root, { recursive: true, force: true })
  }
})

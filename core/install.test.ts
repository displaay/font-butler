import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { commitInstalledFile } from './install.ts'
import { noopFontNative } from './native.ts'
import { ATOMIC_FONT_TEMP_SUFFIX } from './user-fonts.ts'

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

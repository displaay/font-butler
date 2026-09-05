import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { moveToTrash, realDesktopShell, revealInFileManager, setDesktopShell } from './reveal.ts'

test('Finder trash failure leaves the file and does not fall back to delete', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-trash-'))
  const file = path.join(dir, 'Keep.ttf')
  try {
    fs.writeFileSync(file, 'font')
    setDesktopShell(
      realDesktopShell(async () => {
        throw new Error('Finder is unavailable')
      }),
    )
    await assert.rejects(() => moveToTrash(file), /Finder could not move that file to Trash/)
    assert.equal(fs.existsSync(file), true)
  } finally {
    setDesktopShell(null)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the test desktop shell deletes the file without calling Finder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-trash-ok-'))
  const file = path.join(dir, 'Gone.ttf')
  try {
    fs.writeFileSync(file, 'font')
    setDesktopShell({
      async reveal() {},
      async moveToTrash(filePath) {
        fs.rmSync(filePath, { force: true })
      },
    })
    await moveToTrash(file)
    assert.equal(fs.existsSync(file), false)
  } finally {
    setDesktopShell(null)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('reveal records the requested path through the desktop shell', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-reveal-'))
  const file = path.join(dir, 'Show.ttf')
  const revealed: string[] = []
  try {
    fs.writeFileSync(file, 'font')
    setDesktopShell({
      async reveal(targetPath) {
        revealed.push(targetPath)
      },
      async moveToTrash() {},
    })
    await revealInFileManager(file)
    assert.deepEqual(revealed, [file])
  } finally {
    setDesktopShell(null)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

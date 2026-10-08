import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { commitInstalledFile } from './install.ts'
import { noopFontNative } from './native.ts'

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

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fingerprintBuffer, fingerprintFile } from './fingerprint.ts'

test('streaming fingerprintFile matches a full-buffer SHA-256', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-fingerprint-'))
  try {
    const file = path.join(dir, 'blob.bin')
    const data = Buffer.alloc(80 * 1024, 7)
    data[0] = 1
    data[data.length - 1] = 9
    fs.writeFileSync(file, data)
    assert.equal(fingerprintFile(file), fingerprintBuffer(data))
    assert.equal(fingerprintFile(file), crypto.createHash('sha256').update(data).digest('hex'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

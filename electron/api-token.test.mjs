import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { apiTokenFilePath, readApiTokenFile } from './api-token.mjs'

test('api token path follows FONT_BUTLER_DATA, then macOS Application Support, then the project data dir', () => {
  assert.equal(
    apiTokenFilePath({ dataOverride: '/tmp/font-data', platform: 'darwin', home: '/Users/me' }),
    path.join('/tmp/font-data', 'api-token'),
  )
  assert.equal(
    apiTokenFilePath({ dataOverride: '', platform: 'darwin', home: '/Users/me' }),
    path.join('/Users/me', 'Library/Application Support/Font Buttler', 'api-token'),
  )
  assert.equal(
    apiTokenFilePath({ dataOverride: '', platform: 'linux', cwd: '/repo', home: '/home/me' }),
    path.join('/repo', '.font-butler-data', 'api-token'),
  )
})

test('readApiTokenFile ignores short or missing files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-token-'))
  try {
    assert.equal(readApiTokenFile(path.join(dir, 'missing')), null)
    const shortPath = path.join(dir, 'short')
    fs.writeFileSync(shortPath, 'tiny')
    assert.equal(readApiTokenFile(shortPath), null)
    const okPath = path.join(dir, 'ok')
    fs.writeFileSync(okPath, '0123456789abcdef')
    assert.equal(readApiTokenFile(okPath), '0123456789abcdef')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

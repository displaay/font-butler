import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fingerprintBuffer } from './fingerprint.ts'
import {
  isRevisionFingerprint,
  readRevisionBytes,
  revisionFilePath,
  storeRevision,
} from './revisions.ts'
import { tempPaths, writeTestFont } from './test-util.ts'

test('revision fingerprints must be sha256 hex', () => {
  assert.equal(isRevisionFingerprint('a'.repeat(64)), true)
  assert.equal(isRevisionFingerprint('/etc/passwd'), false)
  assert.equal(isRevisionFingerprint(`../${'a'.repeat(64)}`), false)
  assert.equal(isRevisionFingerprint('not-a-hash'), false)
})

test('revision reads reject absolute paths and traversal', () => {
  const paths = tempPaths('font-butler-rev-')
  try {
    assert.equal(readRevisionBytes(paths, '/etc/passwd'), undefined)
    assert.equal(readRevisionBytes(paths, `../../../../etc/passwd`), undefined)
    assert.throws(() => revisionFilePath(paths, '/etc/passwd'), /not valid/)
    assert.throws(() => revisionFilePath(paths, `../${'b'.repeat(62)}`), /not valid/)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('stored revisions are readable only by their fingerprint', () => {
  const paths = tempPaths('font-butler-rev-')
  try {
    const font = path.join(paths.dataRoot, 'Face.ttf')
    writeTestFont(font, 'Face', 'Face-Regular')
    const stored = storeRevision(paths, font, { format: 'ttf' })
    assert.ok(stored)
    const bytes = readRevisionBytes(paths, stored.fingerprint)
    assert.ok(bytes)
    assert.equal(fingerprintBuffer(bytes), stored.fingerprint)
    assert.equal(fs.existsSync(revisionFilePath(paths, stored.fingerprint)), true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

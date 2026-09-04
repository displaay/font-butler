import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { isFullyUnderAnyRoot, isUnderAnyRoot } from './containment.ts'

test('isUnderAnyRoot treats a symlink to a protected root as protected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-contain-'))
  const protectedDir = path.join(root, 'system-fonts')
  const outside = path.join(root, 'outside')
  fs.mkdirSync(protectedDir)
  fs.mkdirSync(outside)
  const target = path.join(protectedDir, 'Protected.otf')
  const link = path.join(outside, 'Evil.otf')
  fs.writeFileSync(target, 'font')
  fs.symlinkSync(target, link)
  try {
    assert.equal(isUnderAnyRoot(link, [protectedDir]), true)
    assert.equal(isFullyUnderAnyRoot(link, [protectedDir]), false)
    assert.equal(isFullyUnderAnyRoot(target, [protectedDir]), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('isFullyUnderAnyRoot rejects a managed symlink that points outside', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-contain-'))
  const allowed = path.join(root, 'user-fonts')
  const secret = path.join(root, 'secret.txt')
  fs.mkdirSync(allowed)
  fs.writeFileSync(secret, 'nope')
  const link = path.join(allowed, 'Trap.otf')
  fs.symlinkSync(secret, link)
  try {
    assert.equal(isFullyUnderAnyRoot(link, [allowed]), false)
    assert.equal(isUnderAnyRoot(link, [allowed]), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

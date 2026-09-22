import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  defaultTestInstallDir,
  deleteTestInstallFiles,
  resolveTestInstallFile,
  scanTestInstallDir,
  testInstallId,
  TEST_INSTALL_APP_NAME,
} from './test-install.ts'

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

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { applyFolderPatch, createWatchFolder } from './folders.ts'

test('watch folders persist a Mac+Adobe destination choice', () => {
  const root = path.join(os.tmpdir(), 'font-butler-inbox')
  const folder = createWatchFolder(root, { destinationId: 'macos-and-adobe' })
  assert.equal(folder.destinationId, 'macos-and-adobe')
  assert.equal(applyFolderPatch(folder, { destinationId: 'macos' }).destinationId, 'macos')
  assert.equal(
    applyFolderPatch(folder, { destinationId: 'adobe-shared' }).destinationId,
    'adobe-shared',
  )
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WOFF_INSTALL_ERROR } from './formats.ts'
import {
  actionCopy,
  actionCopyFor,
  adobeInstallCopy,
  emptyImportError,
  importDoneCopy,
  remainingActionCopy,
} from './notify.ts'

test('actionCopy names the family and uses an ellipsis while pending', () => {
  assert.deepEqual(actionCopy('install', 'Inter'), {
    pending: 'Installing Inter…',
    done: 'Installed Inter',
  })
})

test('actionCopy explains forget as a list removal', () => {
  assert.deepEqual(actionCopy('forget', 'Recoleta'), {
    pending: 'Removing Recoleta from the list…',
    done: 'Removed Recoleta from the list',
  })
})

test('actionCopyFor uses a count when more than one family is selected', () => {
  assert.deepEqual(
    actionCopyFor('remove', [{ familyName: 'Inter' }, { familyName: 'Recoleta' }]),
    {
      pending: 'Removing 2 fonts…',
      done: 'Removed 2 fonts',
    },
  )
})

test('remainingActionCopy counts remaining fonts down', () => {
  assert.equal(remainingActionCopy('install', 5), 'Installing 5 fonts…')
  assert.equal(remainingActionCopy('install', 1), 'Installing 1 font…')
  assert.equal(remainingActionCopy('install', 1, 'Inter'), 'Installing Inter…')
})

test('importDoneCopy mentions ignored web fonts only in the success line', () => {
  assert.equal(
    importDoneCopy({ installed: true, count: 1, name: 'Inter', ignored: 0 }),
    'Installed Inter',
  )
  assert.equal(importDoneCopy({ installed: true, count: 5, ignored: 0 }), 'Installed 5 fonts')
  assert.equal(
    importDoneCopy({ installed: true, count: 5, ignored: 3 }),
    '5 fonts installed and 3 fonts ignored',
  )
  assert.equal(
    importDoneCopy({ installed: false, count: 1, name: 'Inter', ignored: 2 }),
    '1 font added and 2 fonts ignored',
  )
  assert.equal(
    importDoneCopy({ installed: true, count: 3, preview: 1 }),
    '2 fonts installed and 1 preview-only',
  )
  assert.equal(
    importDoneCopy({ installed: false, count: 1, name: 'Web', preview: 1 }),
    'Added preview of Web',
  )
})

test('adobeInstallCopy singularizes a single placement', () => {
  assert.deepEqual(adobeInstallCopy(1), {
    pending: 'Placing Adobe testing copy…',
    done: 'Placed Adobe testing copy',
  })
  assert.deepEqual(adobeInstallCopy(0), {
    pending: 'Placing Adobe testing copy…',
    done: 'Placed Adobe testing copy',
  })
  assert.deepEqual(adobeInstallCopy(3), {
    pending: 'Placing 3 Adobe testing copies…',
    done: 'Placed 3 Adobe testing copies',
  })
})

test('emptyImportError prefers real failures over skipped WOFF files', () => {
  assert.equal(
    emptyImportError(['/fonts/Regular.otf: Could not read any faces in that font.'], 2),
    '/fonts/Regular.otf: Could not read any faces in that font.',
  )
  assert.equal(emptyImportError([], 3), WOFF_INSTALL_ERROR)
  assert.equal(emptyImportError([]), 'Could not add fonts')
})

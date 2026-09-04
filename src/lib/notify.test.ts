import assert from 'node:assert/strict'
import { test } from 'node:test'
import { actionCopy, actionCopyFor } from './notify.ts'

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

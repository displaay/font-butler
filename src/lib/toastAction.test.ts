import assert from 'node:assert/strict'
import { test } from 'node:test'
import { doneToastAction, latestUndoableOperationId } from './toastAction.ts'

test('uninstall success toasts Undo when the operation is undoable', () => {
  assert.deepEqual(
    doneToastAction({ undo: true, operationId: 'op-1' }),
    { kind: 'undo', label: 'Undo', operationId: 'op-1' },
  )
})

test('failed items still offer Retry instead of Undo', () => {
  assert.deepEqual(
    doneToastAction({ undo: true, operationId: 'op-1', failedIds: ['a'] }),
    { kind: 'retry', label: 'Retry failed' },
  )
})

test('without an undoable operation id the toast still offers Activity', () => {
  assert.deepEqual(doneToastAction({ undo: true }), { kind: 'activity', label: 'Activity' })
  assert.deepEqual(doneToastAction({ operationId: 'op-2' }), {
    kind: 'activity',
    label: 'Activity',
    operationId: 'op-2',
  })
})

test('latestUndoableOperationId picks the newest matching uninstall', () => {
  assert.equal(
    latestUndoableOperationId(
      [
        { id: 'keep', action: 'uninstall', undoable: true, undone: false },
        { id: 'old', action: 'uninstall', undoable: true, undone: false },
      ],
      'uninstall',
    ),
    'keep',
  )
  assert.equal(
    latestUndoableOperationId(
      [{ id: 'done', action: 'uninstall', undoable: false, undone: true }],
      'uninstall',
    ),
    undefined,
  )
})

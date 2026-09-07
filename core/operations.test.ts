import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createOperation,
  finishOperation,
  loadOperations,
  markAllOperationsRead,
  markOperationsUnread,
  unreadOperationCount,
  upsertOperation,
} from './operations.ts'
import { tempPaths } from './test-util.ts'

test('finishOperation marks watch and startup activity unread', () => {
  const watch = finishOperation(
    createOperation({ trigger: 'watch', action: 'apply-plan', familyName: 'Inter' }),
    [{ id: '1', label: 'Inter', outcome: 'succeeded' }],
  )
  const startup = finishOperation(
    createOperation({ trigger: 'startup', action: 'recover-journal' }),
    [{ id: '2', label: 'Recover', outcome: 'succeeded' }],
  )
  const manual = finishOperation(
    createOperation({ trigger: 'manual', action: 'install', familyName: 'Inter' }),
    [{ id: '3', label: 'Inter', outcome: 'succeeded' }],
  )
  assert.equal(watch.unread, true)
  assert.equal(startup.unread, true)
  assert.equal(manual.unread, false)
})

test('markAllOperationsRead clears persisted unread flags', () => {
  const paths = tempPaths('font-butler-ops-read-')
  const unread = finishOperation(
    createOperation({ trigger: 'watch', action: 'install', familyName: 'News' }),
    [{ id: '1', label: 'News', outcome: 'succeeded' }],
  )
  upsertOperation(paths, unread)
  assert.equal(unreadOperationCount(loadOperations(paths)), 1)
  const cleared = markAllOperationsRead(paths)
  assert.equal(unreadOperationCount(cleared), 0)
  assert.equal(loadOperations(paths)[0]?.unread, false)
})

test('markOperationsUnread keys off operation ids from the operations bus', () => {
  const paths = tempPaths('font-butler-ops-unread-')
  const install = finishOperation(
    createOperation({ trigger: 'manual', action: 'install', familyName: 'Inter' }),
    [{ id: '1', label: 'Inter', outcome: 'succeeded' }],
  )
  const activate = finishOperation(
    createOperation({ trigger: 'manual', action: 'activate', familyName: 'Inter' }),
    [{ id: '2', label: 'Inter', outcome: 'succeeded' }],
  )
  upsertOperation(paths, install)
  upsertOperation(paths, activate)
  markOperationsUnread(paths, [install.id])
  const operations = loadOperations(paths)
  assert.equal(operations.find((item) => item.id === install.id)?.unread, true)
  assert.equal(operations.find((item) => item.id === activate.id)?.unread, false)
})

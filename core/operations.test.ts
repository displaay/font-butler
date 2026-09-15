import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import {
  clearOperations,
  createOperation,
  finishOperation,
  loadOperations,
  markAllOperationsRead,
  markOperationsUnread,
  pruneOperations,
  unreadOperationCount,
  upsertOperation,
} from './operations.ts'
import { operationsPath } from './paths.ts'
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

test('clearOperations wipes persisted activity history', () => {
  const paths = tempPaths('font-butler-ops-clear-')
  const install = finishOperation(
    createOperation({ trigger: 'manual', action: 'install', familyName: 'Inter' }),
    [{ id: '1', label: 'Inter', outcome: 'succeeded' }],
  )
  upsertOperation(paths, install)
  assert.equal(loadOperations(paths).length, 1)
  assert.deepEqual(clearOperations(paths), [])
  assert.deepEqual(loadOperations(paths), [])
})

test('pruneOperations skips rewrite when nothing expired', () => {
  const paths = tempPaths('font-butler-ops-prune-skip-')
  const install = finishOperation(
    createOperation({ trigger: 'manual', action: 'install', familyName: 'Inter' }),
    [{ id: '1', label: 'Inter', outcome: 'succeeded' }],
  )
  upsertOperation(paths, install)
  const file = operationsPath(paths)
  const before = fs.readFileSync(file, 'utf8')
  pruneOperations(paths, { maxAgeMs: 24 * 60 * 60 * 1000, maxCount: 10_000 })
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

test('pruneOperations rewrites when entries are dropped', () => {
  const paths = tempPaths('font-butler-ops-prune-write-')
  const stale = finishOperation(
    createOperation({ trigger: 'manual', action: 'install', familyName: 'Old' }),
    [{ id: '1', label: 'Old', outcome: 'succeeded' }],
  )
  stale.startedAt = Date.now() - 10_000
  upsertOperation(paths, stale)
  pruneOperations(paths, { maxAgeMs: 1000, maxCount: 10_000 })
  assert.deepEqual(loadOperations(paths), [])
})

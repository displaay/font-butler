import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSerialQueue, startQueuedAction } from './actionQueue.ts'

test('enqueue runs tasks in order and does not wait to accept the next task', async () => {
  const queue = createSerialQueue()
  const order: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const first = queue.enqueue(async () => {
    order.push('first-start')
    await firstGate
    order.push('first-end')
    return 1
  })
  const second = queue.enqueue(async () => {
    order.push('second')
    return 2
  })

  assert.equal(queue.pending, 2)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order, ['first-start'])
  releaseFirst()
  assert.deepEqual(await Promise.all([first, second]), [1, 2])
  assert.deepEqual(order, ['first-start', 'first-end', 'second'])
  assert.equal(queue.pending, 0)
})

test('startQueuedAction returns before native work finishes', async () => {
  const queue = createSerialQueue()
  let nativeDone = false
  let release!: () => void
  const native = new Promise<void>((resolve) => {
    release = resolve
  })

  function installFamily() {
    startQueuedAction(queue, async () => {
      await native
      nativeDone = true
    })
  }

  const returned = installFamily()
  assert.equal(returned, undefined)
  assert.equal(nativeDone, false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(nativeDone, false)
  release()
  await queue.enqueue(async () => undefined)
  assert.equal(nativeDone, true)
  assert.equal(queue.pending, 0)
})

test('UI callers can enqueue a second action while native work is running', async () => {
  const queue = createSerialQueue()
  const order: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  function uninstallFamily(label: string, wait?: Promise<void>) {
    startQueuedAction(queue, async () => {
      order.push(`${label}-start`)
      if (wait) await wait
      order.push(`${label}-end`)
    })
  }

  uninstallFamily('first', firstGate)
  uninstallFamily('second')
  assert.equal(queue.pending, 2)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order, ['first-start'])
  releaseFirst()
  await queue.enqueue(async () => undefined)
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end'])
  assert.equal(queue.pending, 0)
})

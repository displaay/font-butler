import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSerialQueue } from './actionQueue.ts'

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

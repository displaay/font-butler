import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enqueuePrompt } from './promptQueue.ts'

test('enqueuePrompt runs resolvers one at a time', async () => {
  const order: string[] = []
  let firstResolve: ((value: string) => void) | undefined
  const first = enqueuePrompt<string>((resolve) => {
    order.push('show-first')
    firstResolve = resolve
  })
  const second = enqueuePrompt<string>((resolve) => {
    order.push('show-second')
    resolve('b')
  })
  await Promise.resolve()
  assert.deepEqual(order, ['show-first'])
  firstResolve?.('a')
  assert.equal(await first, 'a')
  assert.equal(await second, 'b')
  assert.deepEqual(order, ['show-first', 'show-second'])
})

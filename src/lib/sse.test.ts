import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consumeSseBuffer } from './sse.ts'

test('consumeSseBuffer yields complete SSE data events and keeps a partial trailer', () => {
  const seen: string[] = []
  const rest = consumeSseBuffer('data: {"type":"ping"}\n\ndata: {"type":"cat', (data) => {
    seen.push(data)
  })
  assert.deepEqual(seen, ['{"type":"ping"}'])
  assert.equal(rest, 'data: {"type":"cat')
  const seen2: string[] = []
  const rest2 = consumeSseBuffer(`${rest}alog"}\n\n`, (data) => {
    seen2.push(data)
  })
  assert.deepEqual(seen2, ['{"type":"catalog"}'])
  assert.equal(rest2, '')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { familyProgressReporter } from './batch-progress.ts'
import { onEvent } from './events.ts'

function collectProgress() {
  const events: Array<{ done: number; total: number }> = []
  const stop = onEvent((event) => {
    if (event.type === 'action-progress') {
      events.push({ done: event.done, total: event.total })
    }
  })
  return { events, stop }
}

test('family progress counts fonts, not styles', async () => {
  const { events, stop } = collectProgress()
  const progress = familyProgressReporter('install', [
    { id: 'a1', familyName: 'Aguzzo' },
    { id: 'a2', familyName: 'Aguzzo' },
    { id: 'v1', familyName: 'Vinila' },
  ])
  progress.start()
  await progress.mark('a1')
  await progress.mark('a2')
  await progress.mark('v1')
  stop()
  assert.deepEqual(events, [
    { done: 0, total: 2 },
    { done: 1, total: 2 },
    { done: 2, total: 2 },
  ])
})

test('a font is not counted until every style in the pass is done', async () => {
  const { events, stop } = collectProgress()
  const progress = familyProgressReporter('uninstall', [
    { id: 'a1', familyName: 'Aguzzo' },
    { id: 'a2', familyName: 'Aguzzo' },
  ])
  progress.start()
  await progress.mark('a1')
  await progress.mark('a2')
  stop()
  assert.deepEqual(events, [
    { done: 0, total: 1 },
    { done: 1, total: 1 },
  ])
})

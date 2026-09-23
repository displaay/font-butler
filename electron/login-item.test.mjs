import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createLoginItemApplier } from './login-item.mjs'

function fakeLoginItem(initial) {
  const calls = []
  let state = initial
  return {
    calls,
    get: () => ({ openAtLogin: state }),
    set: (settings) => {
      calls.push(settings.openAtLogin)
      state = settings.openAtLogin
    },
  }
}

test('login item is set only when openAtLogin changes', () => {
  const item = fakeLoginItem(false)
  const apply = createLoginItemApplier(item)
  for (let i = 0; i < 16; i += 1) apply(false)
  assert.deepEqual(item.calls, [])
  apply(true)
  apply(true)
  apply(undefined)
  apply(false)
  assert.deepEqual(item.calls, [true, false])
})

test('a rejected set is not retried on every settings event', () => {
  const calls = []
  const apply = createLoginItemApplier({
    get: () => ({ openAtLogin: false }),
    set: (settings) => calls.push(settings.openAtLogin),
  })
  for (let i = 0; i < 11; i += 1) apply(true)
  assert.deepEqual(calls, [true])
})

test('a failing getter still sets the login item once', () => {
  const calls = []
  const apply = createLoginItemApplier({
    get: () => {
      throw new Error('unavailable')
    },
    set: (settings) => calls.push(settings.openAtLogin),
  })
  apply(false)
  apply(false)
  assert.deepEqual(calls, [false])
})

test('main process routes every openAtLogin update through the change-only applier', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(main, /createLoginItemApplier\(/)
  assert.equal(main.match(/setLoginItemSettings\(/g)?.length, 1)
  assert.match(main, /set: \(settings\) => app\.setLoginItemSettings\(settings\)/)
})

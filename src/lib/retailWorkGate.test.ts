import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRetailWorkGate } from './retailWorkGate.ts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('onboarding navigation waits for an in-flight retail configure before completion', async () => {
  const gate = createRetailWorkGate()
  const hold = deferred()
  let enabled = false
  gate.track(async () => {
    await hold.promise
    enabled = true
  })

  let installed = false
  const finish = (async () => {
    await gate.settle()
    installed = enabled
  })()

  await Promise.resolve()
  assert.equal(installed, false)
  hold.resolve()
  await finish
  assert.equal(installed, true)
})

test('settle includes a family or token edit queued while an earlier retail configure is still running', async () => {
  const gate = createRetailWorkGate()
  const hold = deferred()
  const applied: string[] = []
  gate.track(async () => {
    await hold.promise
    applied.push('sync')
    gate.track(async () => {
      applied.push('family')
    })
  })

  let seen: string[] = []
  const finish = (async () => {
    await gate.settle()
    seen = [...applied]
  })()

  hold.resolve()
  await finish
  assert.deepEqual(seen, ['sync', 'family'])
})

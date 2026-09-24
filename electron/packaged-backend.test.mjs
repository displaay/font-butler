import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('the packaged app runs the API in a child process, not in Electron main', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(main, /utilityProcess\.fork/)
  assert.match(main, /FONT_BUTLER_SERVE/)
  assert.match(main, /spawnApiWorker/)
  assert.doesNotMatch(main, /await import\('\.\/server\.bundle\.mjs'\)/)
})

test('packaged bootstrap waits for the API before loading the UI', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(main, /async function bootstrapApi/)
  assert.match(main, /const bootstrapOk = await bootstrapApi\(\)/)
  assert.match(main, /if \(bootstrapOk\)\s*\{\s*createWindow\(\)/s)
  assert.match(main, /if \(app\.isPackaged && !apiBootstrapReady\)\s*\{\s*return/s)
  assert.match(main, /showBootstrapFailure/)
})

test('service init failure exits the API worker process', () => {
  const server = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8')
  assert.match(server, /Font Buttler service init failed/)
  assert.match(server, /process\.exit\(1\)/)
})

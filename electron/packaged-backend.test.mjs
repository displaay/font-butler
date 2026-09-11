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

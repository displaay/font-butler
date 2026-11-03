import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  RETAIL_EULA_DATE,
  RETAIL_EULA_URL,
  RETAIL_EULA_VERSION,
  retailEulaConsentIsCurrent,
} from '../lib/types.ts'

test('retail EULA constants match the Displaay licence pin', () => {
  assert.equal(RETAIL_EULA_URL, 'https://displaay.net/help/licenses#read-full-terms')
  assert.equal(RETAIL_EULA_VERSION, '2.0.8')
  assert.equal(RETAIL_EULA_DATE, '08 September 2026')
})

test('retailEulaConsentIsCurrent requires the pinned version and a timestamp', () => {
  assert.equal(retailEulaConsentIsCurrent(null), false)
  assert.equal(retailEulaConsentIsCurrent({ eulaConsentVersion: '2.0.8' }), false)
  assert.equal(
    retailEulaConsentIsCurrent({
      eulaConsentVersion: '2.0.7',
      eulaConsentAt: '2026-09-08T12:00:00.000Z',
    }),
    false,
  )
  assert.equal(
    retailEulaConsentIsCurrent({
      eulaConsentVersion: '2.0.8',
      eulaConsentAt: '2026-09-08T12:00:00.000Z',
    }),
    true,
  )
})

test('RetailPane gates enable behind the EULA dialog and stamps acceptEula', async () => {
  const pane = await readFile(fileURLToPath(new URL('./RetailPane.tsx', import.meta.url)), 'utf8')
  assert.match(pane, /RetailEulaDialog/)
  assert.match(pane, /retailEulaConsentIsCurrent/)
  assert.match(pane, /acceptEula:\s*true/)
  assert.match(pane, /requestTurnSyncOn/)

  const dialog = await readFile(fileURLToPath(new URL('./RetailEulaDialog.tsx', import.meta.url)), 'utf8')
  assert.match(dialog, /RETAIL_EULA_URL/)
  assert.match(dialog, /Read full terms/)
  assert.match(dialog, /Accept and turn on/)
  assert.match(dialog, /openAppUpdateUrl/)
})

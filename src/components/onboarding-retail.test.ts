import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fileURLToPath } from 'node:url'
import { RetailPane } from './RetailPane.tsx'
import type { RetailSyncFont, RetailSyncStatus } from '../lib/types.ts'

function font(familyName: string, partial: Partial<RetailSyncFont> = {}): RetailSyncFont {
  return {
    familyName,
    typefaceName: familyName,
    glyphsFile: familyName,
    fileCount: 1,
    enabled: true,
    available: true,
    formats: ['otf'],
    selectedFormat: 'otf',
    ...partial,
  }
}

function status(partial: Partial<RetailSyncStatus> = {}): RetailSyncStatus {
  return {
    enabled: true,
    autoCheckMinutes: 60,
    configured: true,
    hasToken: false,
    mode: 'trial',
    workerBaseUrl: 'https://w.displaay.net',
    checkedAt: '2026-01-01T00:00:00.000Z',
    syncedAt: null,
    pending: 2,
    drift: [],
    skipped: [],
    error: null,
    fonts: [
      font('Reckless'),
      font('Zangezi', { enabled: false, fileCount: 2, formats: ['otf', 'ttf'], selectedFormat: 'otf' }),
    ],
    disabledGlyphsFiles: ['Zangezi'],
    familyFormats: {},
    collisions: [],
    incomplete: false,
    progress: null,
    ...partial,
  }
}

function markup(
  props: Partial<{
    status: RetailSyncStatus | null
    deferInstall: boolean
    defaultAdvanced: boolean
  }> = {},
) {
  return renderToStaticMarkup(
    createElement(RetailPane, {
      status: props.status === undefined ? status() : props.status,
      busy: false,
      onStatus: () => {},
      deferInstall: props.deferInstall,
      defaultAdvanced: props.defaultAdvanced,
    }),
  )
}

test('onboarding retail marks trial fonts and keeps the token under the Settings panel', () => {
  const closed = markup({ deferInstall: true })
  assert.match(closed, /Displaay retail/)
  assert.match(closed, />Trial</)
  assert.match(closed, /Reckless/)
  assert.match(closed, /Zangezi/)
  assert.equal(closed.includes('Worker token'), false)
  assert.match(closed, /Advanced/)
  assert.match(closed, /Show the worker address and token/)
  assert.match(closed, /finish setup/)
  assert.equal(closed.includes('Sync 2'), false)
  assert.equal(closed.includes('Check automatically'), false)

  const open = markup({ deferInstall: true, defaultAdvanced: true })
  assert.match(open, /Worker token/)
  assert.match(open, /placeholder="Retail token"/)
  assert.match(open, />Save</)
  assert.match(open, /trial fonts/)
})

test('onboarding retail lists show and install choices without a second sync control', () => {
  const html = markup({ deferInstall: true })
  assert.match(html, /aria-label="Sync Reckless"/)
  assert.match(html, /aria-label="Sync Zangezi"/)
  assert.match(html, /aria-label="Format for Zangezi"/)
  assert.match(html, />otf</)
  assert.match(html, />ttf</)
  assert.match(html, /On shows that family in the library and installs it after setup/)
  const reckless = html.slice(html.indexOf('Sync Reckless') - 80, html.indexOf('Sync Zangezi'))
  assert.match(reckless, /aria-checked="true"/)
  const zangezi = html.slice(html.indexOf('aria-label="Sync Zangezi"'))
  assert.match(zangezi, /aria-checked="false"/)

  const settings = markup({ deferInstall: false })
  assert.match(settings, />Sync 2</)
  assert.equal(settings.includes('installs it after setup'), false)
})

test('retail font list stays hidden until sync is on', () => {
  const html = markup({ status: status({ enabled: false, fonts: [], mode: null, pending: 0 }), deferInstall: true })
  assert.equal(html.includes('Reckless'), false)
  assert.equal(html.includes('Worker token'), false)
  assert.match(html, /aria-label="Displaay retail sync"/)
})

test('onboarding embeds the Settings retail pane and does not sync while it is open', async () => {
  const source = await readFile(fileURLToPath(new URL('./OnboardingDialog.tsx', import.meta.url)), 'utf8')
  assert.match(source, /<RetailPane[\s\S]*deferInstall/)
  assert.equal(/api\.retail\.sync\(/.test(source), false)
  assert.equal(source.includes('Worker token'), false)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FinderSyncEnableButton, FinderSyncEnableNote } from './FinderSyncEnable.tsx'
import {
  FINDER_SYNC_ENABLE_DESCRIPTION,
  FINDER_SYNC_ENABLE_LABEL,
  FINDER_SYNC_LOGIN_ITEMS_BUTTON,
  FINDER_SYNC_SETTINGS_BUTTON,
  finderSyncEnableAction,
} from '../lib/finderSync.ts'

test('Finder enable copy tells you where to turn the menu on', () => {
  assert.match(FINDER_SYNC_ENABLE_LABEL, /Finder menu/)
  assert.match(FINDER_SYNC_ENABLE_DESCRIPTION, /Install as…/)
  assert.match(FINDER_SYNC_ENABLE_DESCRIPTION, /folder of fonts/)
  assert.match(FINDER_SYNC_ENABLE_DESCRIPTION, /Login Items & Extensions/)
  assert.match(FINDER_SYNC_ENABLE_DESCRIPTION, /extension is off/)
  assert.match(FINDER_SYNC_ENABLE_DESCRIPTION, /Until Font Buttler is allowed in Login Items/)
  assert.match(FINDER_SYNC_ENABLE_DESCRIPTION, /Dropbox/)
  assert.match(FINDER_SYNC_ENABLE_DESCRIPTION, /iCloud/)
  assert.match(FINDER_SYNC_ENABLE_DESCRIPTION, /right-click > Services > Install/)
  assert.match(FINDER_SYNC_ENABLE_DESCRIPTION, /Services/)
  assert.equal(FINDER_SYNC_SETTINGS_BUTTON, 'Open Login Items & Extensions')
  assert.equal(FINDER_SYNC_LOGIN_ITEMS_BUTTON, 'Open Login Items')
  assert.equal(finderSyncEnableAction('requires-approval'), 'login-items')
  assert.equal(finderSyncEnableAction('not-registered'), 'login-items')
  assert.equal(finderSyncEnableAction('enabled'), 'extensions')
  assert.equal(finderSyncEnableAction('unsupported'), 'none')

  const note = renderToStaticMarkup(createElement(FinderSyncEnableNote))
  assert.match(note, /Finder menu/)
  assert.match(note, /Login Items &amp; Extensions/)
  assert.match(note, /Install as…/)
  assert.match(note, /Open Login Items &amp; Extensions/)
  const button = renderToStaticMarkup(createElement(FinderSyncEnableButton))
  assert.match(button, /Open Login Items &amp; Extensions/)
  const approval = renderToStaticMarkup(createElement(FinderSyncEnableNote, { status: 'requires-approval' }))
  assert.match(approval, /Open Login Items/)
  assert.match(approval, /Until Font Buttler is allowed in Login Items/)
  assert.doesNotMatch(approval, /Open Login Items &amp; Extensions/)
  const toggledOff = renderToStaticMarkup(createElement(FinderSyncEnableButton, { status: 'not-registered' }))
  assert.match(toggledOff, /Open Login Items/)
  assert.match(toggledOff, /Finder menu in Login Items/)

  const settings = readFileSync(new URL('./SettingsDialog.tsx', import.meta.url), 'utf8')
  const onboarding = readFileSync(new URL('./OnboardingDialog.tsx', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8')
  assert.match(settings, /FinderSyncEnableButton/)
  assert.match(onboarding, /step === 'welcome'[\s\S]*FinderSyncEnableNote/)
  assert.match(onboarding, /step === 'done'[\s\S]*FinderSyncEnableNote/)
  assert.match(preload, /openFinderExtensions/)
  assert.match(preload, /openFinderSyncLoginItems/)
  assert.match(preload, /setFinderSyncAgentEnabled/)
})

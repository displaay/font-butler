import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closedSettingsFocus, startOnboardingFromSettings } from './settingsSession.ts'

test('closing settings clears app-update and watch-folder deep-link focus', () => {
  assert.deepEqual(closedSettingsFocus(), {
    settingsOpen: false,
    focusAppUpdate: false,
    focusWatchFolders: false,
  })
})

test('start onboarding reuses the settings close and only reopens onboarding', () => {
  const closed = closedSettingsFocus()
  const next = startOnboardingFromSettings()
  assert.equal(next.settingsOpen, closed.settingsOpen)
  assert.equal(next.focusAppUpdate, closed.focusAppUpdate)
  assert.equal(next.focusWatchFolders, closed.focusWatchFolders)
  assert.equal(next.onboardingOpen, true)
  assert.deepEqual(Object.keys(next).sort(), [
    'focusAppUpdate',
    'focusWatchFolders',
    'onboardingOpen',
    'settingsOpen',
  ])
})

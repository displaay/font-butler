import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { DESTINATIONS, destinationLabel, destinationNeedsAdobe, adobeTestingFolderAvailable, GLOBAL_AUTO_REINSTALL_DESCRIPTION, NEW_WATCH_FOLDER_ACTIONS, WATCH_FOLDER_ACTIONS } from './folders.ts'

test('DESTINATIONS includes Mac+Adobe as a default install choice', () => {
  assert.deepEqual(
    DESTINATIONS.map((item) => item.id),
    ['macos', 'adobe-shared', 'macos-and-adobe'],
  )
  assert.equal(destinationLabel('macos-and-adobe'), 'This Mac and Adobe folder')
  assert.equal(destinationNeedsAdobe('macos'), false)
  assert.equal(destinationNeedsAdobe('adobe-shared'), true)
  assert.equal(destinationNeedsAdobe('macos-and-adobe'), true)
})

test('watch folder create and edit use two checkboxes, not policy presets', () => {
  assert.deepEqual(NEW_WATCH_FOLDER_ACTIONS, { installNew: true, autoUpdate: true })
  assert.deepEqual(
    WATCH_FOLDER_ACTIONS.map((action) => action.label),
    [
      'Install fonts added to watch folders',
      'Automatically reinstall when an update is detected',
    ],
  )
  for (const preset of ['Add to library', 'Install new fonts', 'Install new fonts and updates']) {
    assert.equal(
      WATCH_FOLDER_ACTIONS.some((action) => action.label === preset),
      false,
    )
  }
  assert.doesNotMatch(GLOBAL_AUTO_REINSTALL_DESCRIPTION, /Add to library/)
  assert.match(GLOBAL_AUTO_REINSTALL_DESCRIPTION, /checkbox, which wins/)

  const setup = fs.readFileSync(new URL('../components/FolderSetupDialog.tsx', import.meta.url), 'utf8')
  const settings = fs.readFileSync(new URL('../components/SettingsDialog.tsx', import.meta.url), 'utf8')
  assert.match(setup, /WATCH_FOLDER_ACTIONS/)
  assert.equal(setup.includes('FOLDER_POLICIES'), false)
  assert.equal(setup.includes('Add to library'), false)
  assert.equal(setup.includes('Install new fonts and updates'), false)
  assert.equal(settings.includes('installWatchFolderFonts'), false)
  assert.equal(settings.includes('FOLDER_POLICIES'), false)
  assert.match(settings, /WATCH_FOLDER_ACTIONS/)
  assert.match(settings, /GLOBAL_AUTO_REINSTALL_DESCRIPTION/)
})

test('adobeTestingFolderAvailable is false only when the Adobe destination is unsupported', () => {
  assert.equal(adobeTestingFolderAvailable(undefined), true)
  assert.equal(adobeTestingFolderAvailable([]), true)
  assert.equal(
    adobeTestingFolderAvailable([
      {
        id: 'adobe-shared',
        label: 'Adobe folder',
        path: '/Library/Application Support/Adobe/Fonts',
        exists: true,
        writable: true,
        supported: true,
        activationVerified: false,
      },
    ]),
    true,
  )
  assert.equal(
    adobeTestingFolderAvailable([
      {
        id: 'adobe-shared',
        label: 'Adobe folder',
        path: '/Library/Application Support/Adobe/Fonts',
        exists: false,
        writable: false,
        supported: false,
        activationVerified: false,
        reason: 'The destination is not available.',
      },
    ]),
    false,
  )
})

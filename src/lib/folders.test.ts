import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DESTINATIONS, destinationLabel, destinationNeedsAdobe, adobeTestingFolderAvailable } from './folders.ts'

test('DESTINATIONS includes Mac+Adobe as a default install choice', () => {
  assert.deepEqual(
    DESTINATIONS.map((item) => item.id),
    ['macos', 'adobe-shared', 'macos-and-adobe'],
  )
  assert.equal(destinationLabel('macos-and-adobe'), 'This Mac and Adobe testing folder')
  assert.equal(destinationNeedsAdobe('macos'), false)
  assert.equal(destinationNeedsAdobe('adobe-shared'), true)
  assert.equal(destinationNeedsAdobe('macos-and-adobe'), true)
})

test('adobeTestingFolderAvailable is false only when the Adobe destination is unsupported', () => {
  assert.equal(adobeTestingFolderAvailable(undefined), true)
  assert.equal(adobeTestingFolderAvailable([]), true)
  assert.equal(
    adobeTestingFolderAvailable([
      {
        id: 'adobe-shared',
        label: 'Adobe testing folder',
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
        label: 'Adobe testing folder',
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

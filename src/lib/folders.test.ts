import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DESTINATIONS, destinationLabel, destinationNeedsAdobe } from './folders.ts'

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

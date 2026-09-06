import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectionScopeLabel, displayStateLabel, isNotInstalledLabel, needsLocateSource } from './state.ts'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

function face(): FontFaceInfo {
  return {
    familyName: 'State',
    styleName: 'Regular',
    fullName: 'State Regular',
    postscriptName: 'State-Regular',
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function entry(partial: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'state',
    sourcePath: '/tmp/State.otf',
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [face()],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('isNotInstalledLabel is only true for library-only uninstalled fonts', () => {
  assert.equal(isNotInstalledLabel(entry({ status: 'uninstalled' })), true)
  assert.equal(isNotInstalledLabel(entry({ status: 'installed' })), false)
  assert.equal(
    isNotInstalledLabel(entry({ status: 'uninstalled', disabledPath: '/tmp/parked/State.otf' })),
    false,
  )
})

test('displayStateLabel compounds installation and source facts', () => {
  assert.equal(
    displayStateLabel(entry({ sourceAvailability: 'missing', status: 'installed' })),
    'Installed · Source missing',
  )
  assert.equal(
    displayStateLabel(
      entry({
        sourcePath: '/tmp/installed/State.otf',
        installedPath: '/tmp/installed/State.otf',
        sourceAvailability: 'none',
      }),
    ),
    'Installed',
  )
  assert.equal(
    displayStateLabel(entry({ previewOnly: true, sourceAvailability: 'present' })),
    'Web font · Preview only',
  )
  assert.equal(
    displayStateLabel(entry({ sourceAvailability: 'offline' })),
    'Installed · Source drive offline',
  )
  assert.match(
    displayStateLabel(
      entry({
        sourceAvailability: 'present',
        installations: [
          {
            destinationId: 'adobe-shared',
            path: '/tmp/adobe/State.otf',
            verification: 'file-present',
          },
        ],
      }),
    ),
    /Adobe testing folder/,
  )
})

test('needsLocateSource covers missing and unlinked installed fonts', () => {
  assert.equal(needsLocateSource(entry({ sourceAvailability: 'missing' })), true)
  assert.equal(
    needsLocateSource(
      entry({
        sourceAvailability: 'none',
        installedPath: '/tmp/installed/State.otf',
      }),
    ),
    true,
  )
  assert.equal(needsLocateSource(entry({ sourceAvailability: 'present' })), false)
})

test('collectionScopeLabel names every face in a collection file', () => {
  assert.equal(collectionScopeLabel(entry()), null)
  assert.equal(
    collectionScopeLabel(
      entry({
        faces: [
          face(),
          {
            ...face(),
            styleName: 'Bold',
            fullName: 'State Bold',
            postscriptName: 'State-Bold',
            weight: 700,
          },
        ],
      }),
    ),
    'This changes all 2 faces in this collection.',
  )
})

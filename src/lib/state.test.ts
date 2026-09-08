import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectionScopeLabel,
  displayStateLabel,
  entryCopyDestinations,
  familyCopyDestinations,
  instanceInstallLabel,
  instanceInstallState,
  isNotInstalledLabel,
  needsLocateSource,
} from './state.ts'
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

test('instanceInstallState maps live, inactive, and missing copies', () => {
  assert.equal(instanceInstallState(entry({ status: 'installed' })), 'installed')
  assert.equal(instanceInstallState(entry({ status: 'outdated' })), 'installed')
  assert.equal(instanceInstallState(entry({ status: 'deactivated' })), 'deactivated')
  assert.equal(instanceInstallState(entry({ status: 'uninstalled' })), 'uninstalled')
  assert.equal(instanceInstallState(entry({ status: 'source-missing' })), 'uninstalled')
  assert.equal(
    instanceInstallState(entry({ status: 'source-missing', installedPath: '/tmp/State.otf' })),
    'deactivated',
  )
  assert.equal(
    instanceInstallState(entry({ status: 'uninstalled', disabledPath: '/tmp/parked/State.otf' })),
    'deactivated',
  )
  assert.equal(instanceInstallState(entry({ previewOnly: true, status: 'uninstalled' })), 'uninstalled')
  assert.deepEqual(
    (['installed', 'deactivated', 'uninstalled'] as const).map(instanceInstallLabel),
    ['Installed', 'Deactivated', 'Not installed'],
  )
})

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
})

test('copy destinations follow Mac and Adobe file-present copies', () => {
  assert.deepEqual(entryCopyDestinations(entry({ status: 'uninstalled' })), {
    macos: false,
    adobe: false,
  })
  assert.deepEqual(entryCopyDestinations(entry({ status: 'installed' })), {
    macos: true,
    adobe: false,
  })
  assert.deepEqual(
    entryCopyDestinations(
      entry({
        installedPath: '/Library/Fonts/State.otf',
        installations: [
          { destinationId: 'macos', path: '/Library/Fonts/State.otf', verification: 'file-present' },
          {
            destinationId: 'adobe-shared',
            path: '/tmp/adobe/State.otf',
            verification: 'file-present',
          },
        ],
      }),
    ),
    { macos: true, adobe: true },
  )
  assert.deepEqual(
    familyCopyDestinations([
      entry({ id: 'mac', installedPath: '/Library/Fonts/State.otf' }),
      entry({
        id: 'adobe',
        installations: [
          {
            destinationId: 'adobe-shared',
            path: '/tmp/adobe/State.otf',
            verification: 'file-present',
          },
        ],
      }),
    ]),
    { macos: true, adobe: true },
  )
  assert.deepEqual(
    entryCopyDestinations(
      entry({
        status: 'deactivated',
        installedPath: '/Library/Fonts/State.otf',
        disabledPath: '/tmp/Disabled/State.otf',
        installations: [
          { destinationId: 'macos', path: '/Library/Fonts/State.otf', verification: 'file-present' },
          {
            destinationId: 'adobe-shared',
            path: '/tmp/adobe/State.otf',
            verification: 'file-present',
          },
        ],
      }),
    ),
    { macos: false, adobe: false },
  )
  assert.deepEqual(
    familyCopyDestinations([
      entry({
        id: 'parked',
        status: 'deactivated',
        disabledPath: '/tmp/Disabled/State.otf',
        installations: [
          {
            destinationId: 'adobe-shared',
            path: '/tmp/adobe/State.otf',
            parkedPath: '/tmp/Disabled/Adobe.otf',
            verification: 'unavailable',
          },
        ],
      }),
    ]),
    { macos: false, adobe: false },
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

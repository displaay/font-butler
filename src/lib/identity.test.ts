import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sameFaceIdentity as coreSameFaceIdentity } from '../../core/identity.ts'
import {
  canSwitchTo,
  catalogOccupiedDestinations,
  occupyingSiblings,
  sameFaceIdentity,
} from './identity.ts'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

function face(psName: string, extras: Partial<FontFaceInfo> = {}): FontFaceInfo {
  const family = extras.familyName ?? 'Face'
  const style = extras.styleName ?? 'Regular'
  return {
    familyName: family,
    styleName: style,
    fullName: `${family} ${style}`,
    postscriptName: psName,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
    ...extras,
  }
}

function entry(partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id'>): CatalogEntry {
  return {
    sourcePath: `/tmp/${partial.id}.ttf`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'uninstalled',
    faces: [face('Face-Regular')],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('renderer sameFaceIdentity matches core for format-aware mutex', () => {
  const ttf = entry({ id: 'a', format: 'ttf', faces: [face('Face-Regular')] })
  const otf = entry({ id: 'b', format: 'otf', sourcePath: '/tmp/b.otf', faces: [face('Face-Regular')] })
  const other = entry({ id: 'c', faces: [face('Other-Regular')] })
  assert.equal(sameFaceIdentity(ttf, ttf), coreSameFaceIdentity(ttf, ttf))
  assert.equal(sameFaceIdentity(ttf, otf), coreSameFaceIdentity(ttf, otf))
  assert.equal(sameFaceIdentity(ttf, other), coreSameFaceIdentity(ttf, other))
  assert.equal(sameFaceIdentity(ttf, otf), false)
})

test('Switch uses occupiedDestinations from core, not installed status', () => {
  const live = entry({
    id: 'live',
    status: 'uninstalled',
    occupiedDestinations: ['macos'],
  })
  const parked = entry({
    id: 'parked',
    status: 'installed',
    occupiedDestinations: [],
    installedPath: '/tmp/gone.ttf',
  })
  const wip = entry({ id: 'wip', status: 'deactivated' })
  assert.deepEqual(
    occupyingSiblings(wip, [live, parked, wip]).map((item) => item.id),
    ['live'],
  )
  assert.equal(canSwitchTo(wip, [live, parked, wip]), true)
  assert.equal(canSwitchTo(wip, [parked, wip]), false)
  assert.equal(canSwitchTo(live, [live, parked, wip]), false)
})

test('without occupiedDestinations, occupancy follows live installation copies', () => {
  const adobeLive = entry({
    id: 'adobe',
    status: 'deactivated',
    installations: [
      {
        destinationId: 'adobe-shared',
        path: '/tmp/adobe.otf',
        verification: 'file-present',
      },
    ],
  })
  const parkedMac = entry({
    id: 'parked-mac',
    status: 'installed',
    installations: [
      {
        destinationId: 'macos',
        path: '/tmp/mac.ttf',
        parkedPath: '/tmp/vault.ttf',
        verification: 'unavailable',
      },
    ],
  })
  assert.deepEqual(catalogOccupiedDestinations(adobeLive), ['adobe-shared'])
  assert.deepEqual(catalogOccupiedDestinations(parkedMac), [])
  const wip = entry({ id: 'wip', status: 'uninstalled' })
  assert.equal(canSwitchTo(wip, [adobeLive, parkedMac, wip]), true)
  assert.equal(canSwitchTo(wip, [parkedMac, wip]), false)
})

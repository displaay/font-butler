import assert from 'node:assert/strict'
import { test } from 'node:test'
import { familyHasSwitch, switchableEntries } from './eligibility.ts'
import { listFormatConflicts } from './formats.ts'
import {
  canSwitchTo,
  canSwitchToConflicts,
  crossFormatOccupyingSiblings,
  occupyingSiblings,
} from './identity.ts'
import type { CatalogEntry, FamilyGroup, FontFaceInfo } from './types.ts'

function face(familyName: string, styleName = 'Regular'): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function entry(
  partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'format' | 'status'>,
): CatalogEntry {
  return {
    sourcePath: `/tmp/${partial.id}.${partial.format}`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    faces: [face('Face')],
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

function group(entries: CatalogEntry[]): FamilyGroup {
  return {
    key: 'Face',
    familyName: 'Face',
    entries,
    faces: entries.flatMap((item) => item.faces),
    isVariable: false,
    instanceCount: entries.length,
    status: entries[0]!.status,
    previewEntryId: entries[0]!.id,
    addedAt: 1,
  }
}

test('OTF live + TTF kept hides Switch and still offers Replace', () => {
  const otf = entry({ id: 'otf', format: 'otf', status: 'installed' })
  const ttf = entry({ id: 'ttf', format: 'ttf', status: 'uninstalled' })
  const catalog = [otf, ttf]
  assert.equal(canSwitchTo(ttf, catalog), false)
  assert.equal(canSwitchTo(otf, catalog), false)
  assert.deepEqual(occupyingSiblings(ttf, catalog), [])
  assert.deepEqual(
    crossFormatOccupyingSiblings(ttf, catalog).map((item) => item.id),
    ['otf'],
  )
  const conflicts = listFormatConflicts([ttf], catalog)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0]!.existing.id, 'otf')
  assert.equal(familyHasSwitch(group(catalog), catalog), false)
  assert.deepEqual(switchableEntries(group(catalog), catalog), [])
})

test('same-format inactive copy still offers Switch', () => {
  const live = entry({ id: 'live', format: 'ttf', status: 'installed' })
  const kept = entry({ id: 'kept', format: 'ttf', status: 'uninstalled' })
  const catalog = [live, kept]
  assert.equal(canSwitchTo(kept, catalog), true)
  assert.equal(canSwitchTo(live, catalog), false)
  assert.deepEqual(
    occupyingSiblings(kept, catalog).map((item) => item.id),
    ['live'],
  )
  assert.deepEqual(crossFormatOccupyingSiblings(kept, catalog), [])
  assert.equal(familyHasSwitch(group(catalog), catalog), true)
  assert.deepEqual(
    switchableEntries(group(catalog), catalog).map((item) => item.id),
    ['kept'],
  )
})

test('deactivated same-format copy can Switch; installed copy cannot', () => {
  const live = entry({ id: 'live', format: 'otf', status: 'installed' })
  const parked = entry({ id: 'parked', format: 'otf', status: 'deactivated' })
  const catalog = [live, parked]
  assert.equal(canSwitchTo(parked, catalog), true)
  assert.equal(canSwitchTo(live, catalog), false)
})

test('watch-folder Switch stays hidden when the occupier is a different format', () => {
  const otf = entry({ id: 'otf', format: 'otf', status: 'installed' })
  const ttf = entry({ id: 'ttf', format: 'ttf', status: 'installed' })
  assert.equal(canSwitchToConflicts('ttf', [otf]), false)
  assert.equal(canSwitchToConflicts('ttf', [ttf]), true)
  assert.equal(canSwitchToConflicts(undefined, [ttf]), false)
})

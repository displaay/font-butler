import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  catalogEntryPickerLabel,
  catalogGroupsForLinkPicker,
  familyPickerSubtitle,
} from './finder-link.ts'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

function face(familyName: string, styleName = 'Regular'): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName.replace(/\s+/g, '')}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function entry(
  id: string,
  familyName: string,
  styleName = 'Regular',
  format = 'otf',
): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.${format}`,
    sourceMtimeMs: 1,
    sourceSize: 1000,
    status: 'installed',
    faces: [face(familyName, styleName)],
    format,
    addedAt: 1,
    updatedAt: 1,
  }
}

test('catalogGroupsForLinkPicker searches family and style names', () => {
  const groups = catalogGroupsForLinkPicker(
    [entry('a', 'Display', 'Regular'), entry('b', 'Display', 'Bold'), entry('c', 'Inter', 'Regular')],
    'bold',
  )
  assert.deepEqual(
    groups.map((group) => group.familyName),
    ['Display'],
  )
  assert.equal(familyPickerSubtitle(groups[0]!), '2 styles')
})

test('catalogGroupsForLinkPicker is empty for an unmatched query', () => {
  assert.deepEqual(catalogGroupsForLinkPicker([entry('a', 'Display')], 'zzz'), [])
})

test('catalogEntryPickerLabel includes style and format', () => {
  assert.equal(catalogEntryPickerLabel(entry('a', 'Display', 'Italic', 'ttf')), 'Italic · TrueType')
})

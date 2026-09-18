import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  catalogEntryPickerLabel,
  catalogGroupsForLinkPicker,
  currentFinderLinkAssignment,
  familyPickerSubtitle,
  finderLinkStyleStatus,
  isPreferredLinkTarget,
  pairFinderFilesToFamily,
  unmatchedFinderLinkCount,
  unmatchedFinderLinkMessage,
} from './finder-link.ts'
import type { CatalogEntry, FontFaceInfo, RelinkPreview } from './types.ts'

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
  extra: Partial<CatalogEntry> = {},
): CatalogEntry {
  return {
    id,
    sourcePath: extra.sourcePath ?? `/tmp/${id}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 1000,
    status: extra.status ?? 'installed',
    sourceAvailability: extra.sourceAvailability,
    faces: extra.faces ?? [face(familyName, styleName)],
    format: extra.format ?? 'otf',
    addedAt: 1,
    updatedAt: 1,
    installedPath: extra.installedPath,
    ...extra,
  }
}

function preview(
  entryId: string,
  proposedPath: string,
  extra: Partial<RelinkPreview> = {},
): RelinkPreview {
  return {
    entryId,
    oldPath: extra.oldPath ?? `/catalog/${entryId}.otf`,
    proposedPath,
    match: extra.match ?? 'identity',
    identityMatch: extra.identityMatch ?? true,
    format: extra.format ?? 'otf',
    bytesDiffer: extra.bytesDiffer ?? true,
    ...extra,
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
  assert.equal(catalogEntryPickerLabel(entry('a', 'Display', 'Italic', { format: 'ttf' })), 'Italic · TrueType')
})

test('pairFinderFilesToFamily leaves extra files unmatched when the family has fewer styles', () => {
  const regular = entry('reg', 'Display', 'Regular')
  const bold = entry('bold', 'Display', 'Bold')
  const files = ['/Fonts/Display-Regular.otf', '/Fonts/Display-Bold.otf', '/Fonts/Display-Italic.otf']
  const assignments = pairFinderFilesToFamily(files, [regular, bold], {
    '/Fonts/Display-Regular.otf': [preview('reg', '/Fonts/Display-Regular.otf'), preview('bold', '/Fonts/Display-Regular.otf', { identityMatch: false, match: 'mismatch' })],
    '/Fonts/Display-Bold.otf': [preview('reg', '/Fonts/Display-Bold.otf', { identityMatch: false, match: 'mismatch' }), preview('bold', '/Fonts/Display-Bold.otf')],
    '/Fonts/Display-Italic.otf': [
      preview('reg', '/Fonts/Display-Italic.otf', { identityMatch: false, match: 'mismatch' }),
      preview('bold', '/Fonts/Display-Italic.otf', { identityMatch: false, match: 'mismatch' }),
    ],
  })
  assert.deepEqual(
    assignments.map((item) => [item.status, item.entryId ?? null]),
    [
      ['pair', 'reg'],
      ['pair', 'bold'],
      ['unmatched', null],
    ],
  )
  assert.equal(unmatchedFinderLinkCount(assignments), 1)
  assert.equal(unmatchedFinderLinkMessage(2), '2 files don’t match this family')
  assert.equal(unmatchedFinderLinkMessage(1), '1 file doesn’t match this family')
  assert.equal(currentFinderLinkAssignment(assignments)?.path, '/Fonts/Display-Regular.otf')
})

test('pairFinderFilesToFamily skips a file already linked to that style', () => {
  const linked = entry('reg', 'Display', 'Regular', {
    sourcePath: '/Fonts/Display-Regular.otf',
    sourceAvailability: 'present',
  })
  const files = ['/Fonts/Display-Regular.otf']
  const assignments = pairFinderFilesToFamily(files, [linked], {
    '/Fonts/Display-Regular.otf': [
      preview('reg', '/Fonts/Display-Regular.otf', {
        oldPath: '/Fonts/Display-Regular.otf',
        match: 'fingerprint',
        bytesDiffer: false,
      }),
    ],
  })
  assert.equal(assignments[0]?.status, 'already-linked')
  assert.equal(assignments[0]?.entryId, 'reg')
  assert.equal(finderLinkStyleStatus(assignments[0]?.preview, assignments[0]), 'Already linked')
  assert.equal(isPreferredLinkTarget(linked), false)
})

test('pairFinderFilesToFamily prefers an unlinked style over an already-linked copy', () => {
  const linked = entry('linked', 'Display', 'Regular', {
    sourcePath: '/Fonts/Display-Regular.otf',
    sourceAvailability: 'present',
    installedPath: '/Library/Fonts/Display-Regular.otf',
  })
  const unlinked = entry('open', 'Display', 'Regular', {
    sourcePath: '/old/Display-Regular.otf',
    sourceAvailability: 'none',
    installedPath: '/Library/Fonts/Display-Regular-copy.otf',
  })
  const files = ['/Fonts/Display-Regular.otf']
  const assignments = pairFinderFilesToFamily(files, [linked, unlinked], {
    '/Fonts/Display-Regular.otf': [
      preview('linked', '/Fonts/Display-Regular.otf', {
        oldPath: '/Fonts/Display-Regular.otf',
        match: 'fingerprint',
        bytesDiffer: false,
      }),
      preview('open', '/Fonts/Display-Regular.otf', {
        oldPath: '/old/Display-Regular.otf',
        match: 'identity',
      }),
    ],
  })
  assert.equal(assignments[0]?.status, 'pair')
  assert.equal(assignments[0]?.entryId, 'open')
  assert.equal(isPreferredLinkTarget(unlinked), true)
})

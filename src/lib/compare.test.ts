import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addCompareFamilies,
  addDroppedFiles,
  automaticFace,
  emptyCompare,
  familyIdForName,
  libraryCompareFamilyId,
  replaceCompareFamilies,
  moveCompareEntry,
  removeCompareEntry,
  replaceCompareFiles,
  resolvedCompareFace,
  shownCompareFamilyIds,
  type CompareFace,
  type CompareFamily,
} from '../../shared/compare.ts'
import { compareDropPaths, comparePathForEntry } from './compare.ts'
import type { CatalogEntry } from './types.ts'

function face(filePath: string, styleName: string, weight: number): CompareFace {
  return {
    id: `${filePath}#0`,
    styleName,
    weight,
    italic: /italic/i.test(styleName),
    postscriptName: styleName,
    filePath,
    faceIndex: 0,
  }
}

function family(name: string, faces: CompareFace[]): CompareFamily {
  return { id: familyIdForName(name), name, faces }
}

test('a drop adds a font file to the comparison', () => {
  const regular = face('/Fonts/Outside/Acme-Regular.ttf', 'Regular', 400)
  const bold = face('/Fonts/Outside/Acme-Bold.ttf', 'Bold', 700)
  const dropped = addDroppedFiles(emptyCompare(), [family('Acme', [regular])])
  assert.equal(dropped.entries.length, 1)
  assert.equal(dropped.families[0]?.faces[0]?.filePath, regular.filePath)
  assert.equal(automaticFace(dropped.families[0]!)?.id, regular.id)

  const again = addDroppedFiles(dropped, [family('Acme', [bold])])
  assert.equal(again.entries.length, 2)
  assert.deepEqual(
    again.families[0]?.faces.map((item) => item.filePath),
    [regular.filePath, bold.filePath],
  )
  assert.equal(again.entries[1]?.styleId, bold.id)
})

test('a library family is one Automatic row, even with twelve styles', () => {
  const faces = Array.from({ length: 12 }, (_, index) =>
    face(`/Fonts/Acme/Style-${index}.ttf`, `Style ${index}`, 100 + index * 80),
  )
  const added = addCompareFamilies(emptyCompare(), [family('Acme', faces)])
  assert.equal(added.entries.length, 1)
  assert.equal(added.entries[0]?.styleId, null)
  const second = addCompareFamilies(added, [family('Other', [face('/Fonts/Other/Regular.ttf', 'Regular', 400)])])
  assert.equal(second.entries.length, 2)
  assert.equal(second.entries[1]?.styleId, null)
})

test('dropping Regular after an Automatic Bold row keeps Bold', () => {
  const bold = face('/Fonts/Outside/Acme-Bold.ttf', 'Bold', 700)
  const regular = face('/Fonts/Outside/Acme-Regular.ttf', 'Regular', 400)
  const dropped = addDroppedFiles(emptyCompare(), [family('Acme', [bold])])
  assert.equal(dropped.entries.length, 1)
  assert.equal(dropped.entries[0]?.styleId, null)
  assert.equal(resolvedCompareFace(dropped.entries[0]!, dropped.families[0]!)?.styleName, 'Bold')

  const again = addDroppedFiles(dropped, [family('Acme', [regular])])
  assert.equal(again.entries.length, 2)
  const familyAfter = again.families[0]!
  assert.deepEqual(
    again.entries.map((entry) => resolvedCompareFace(entry, familyAfter)?.styleName),
    ['Bold', 'Regular'],
  )
})

test('opening two files of one family keeps one row per file', () => {
  const first = face('/Fonts/v1/Acme-Regular.ttf', 'Regular', 400)
  const second = face('/Fonts/v2/Acme-Regular.ttf', 'Regular', 400)
  const bold = face('/Fonts/v1/Acme-Bold.ttf', 'Bold', 700)
  const opened = replaceCompareFiles([family('Acme', [first, second])])
  assert.equal(opened.entries.length, 2)
  const openedFamily = opened.families[0]!
  assert.deepEqual(
    opened.entries.map((entry) => resolvedCompareFace(entry, openedFamily)?.filePath),
    [first.filePath, second.filePath],
  )
  const styles = replaceCompareFiles([family('Acme', [bold, first])])
  assert.equal(styles.entries.length, 2)
  const library = replaceCompareFamilies([family('Acme', [first, second, bold])])
  assert.equal(library.entries.length, 1)
  assert.equal(library.entries[0]?.styleId, null)
})

test('two files that are not catalog entries become two comparison rows', () => {
  const alpha = face('/tmp/not-in-catalog/Alpha.ttf', 'Regular', 400)
  const beta = face('/tmp/not-in-catalog/Beta.otf', 'Regular', 400)
  const model = replaceCompareFamilies([family('Alpha', [alpha]), family('Beta', [beta])])
  assert.equal(model.entries.length, 2)
  assert.deepEqual(
    model.families.map((item) => item.faces[0]?.filePath),
    [alpha.filePath, beta.filePath],
  )
  assert.equal(model.entries.every((entry) => !entry.familyId.startsWith('catalog:')), true)
})

test('moving a row downward inserts it before the target', () => {
  const entries = ['a', 'b', 'c'].map((id, tint) => ({
    id,
    familyId: `family:${id}`,
    styleId: null,
    tint,
  }))
  const model = { families: [], entries }
  assert.deepEqual(
    moveCompareEntry(model, 'a', 'c').entries.map((entry) => entry.id),
    ['b', 'a', 'c'],
  )
  assert.deepEqual(
    moveCompareEntry(model, 'c', 'a').entries.map((entry) => entry.id),
    ['c', 'a', 'b'],
  )
})

test('a family checkmark follows visible rows', () => {
  const added = addCompareFamilies(emptyCompare(), [family('Acme', [face('/Fonts/Acme.ttf', 'Regular', 400)])])
  const removed = removeCompareEntry(added, added.entries[0]!.id)
  assert.equal(removed.families.length, 1)
  assert.equal(shownCompareFamilyIds(removed).size, 0)
  assert.equal(shownCompareFamilyIds(added).has(familyIdForName('Acme')), true)
})

test('a custom library name uses the inspected family id', () => {
  const id = libraryCompareFamilyId(['Acme'], 'My Acme')
  assert.equal(id, familyIdForName('Acme'))
  assert.notEqual(id, familyIdForName('My Acme'))
  const added = addCompareFamilies(emptyCompare(), [family('Acme', [face('/Fonts/Acme.ttf', 'Regular', 400)])])
  assert.equal(shownCompareFamilyIds(added).has(id), true)
})

test('compare uses an Adobe copy when the source is missing', () => {
  const entry = {
    status: 'installed',
    sourcePath: '/Fonts/Missing.otf',
    sourcePresent: false,
    installations: [
      {
        destinationId: 'adobe-shared',
        path: '/Adobe/Fonts/Acme.otf',
        verification: 'file-present',
      },
    ],
  } as CatalogEntry
  assert.equal(comparePathForEntry(entry), '/Adobe/Fonts/Acme.otf')
  assert.equal(
    comparePathForEntry({
      status: 'installed',
      installedPath: '/Library/Fonts/Acme.otf',
      sourcePath: '/Fonts/Missing.otf',
      sourcePresent: false,
      installations: [
        { destinationId: 'macos', path: '/Library/Fonts/Acme.otf', verification: 'unavailable' },
        { destinationId: 'adobe-shared', path: '/Adobe/Fonts/Acme.otf', verification: 'file-present' },
      ],
    } as CatalogEntry),
    '/Adobe/Fonts/Acme.otf',
  )
  assert.equal(
    comparePathForEntry({
      status: 'installed',
      installedPath: '/Library/Fonts/Acme.otf',
      installations: [
        { destinationId: 'macos', path: '/Library/Fonts/Acme.otf', verification: 'file-present' },
        { destinationId: 'adobe-shared', path: '/Adobe/Fonts/Acme.otf', verification: 'file-present' },
      ],
    } as CatalogEntry),
    '/Library/Fonts/Acme.otf',
  )
  const parked = {
    status: 'deactivated',
    sourcePath: '/Fonts/Missing.otf',
    sourcePresent: false,
    installations: [
      {
        destinationId: 'adobe-shared',
        path: '/Adobe/Fonts/Acme.otf',
        parkedPath: '/Library/Fonts/.parked/Acme.otf',
        verification: 'unavailable',
      },
    ],
  } as CatalogEntry
  assert.equal(comparePathForEntry(parked), '/Library/Fonts/.parked/Acme.otf')
  assert.equal(
    comparePathForEntry({
      status: 'uninstalled',
      sourcePath: '/Fonts/Missing.otf',
      sourcePresent: false,
    } as CatalogEntry),
    null,
  )
})

test('compare drop paths keep web fonts and folders', () => {
  assert.deepEqual(
    compareDropPaths({
      paths: ['/Fonts/A.woff2', '/Fonts/notes.txt', '/Fonts/B.otf'],
      files: [],
      folders: ['/Fonts/Family'],
    }),
    ['/Fonts/Family', '/Fonts/A.woff2', '/Fonts/B.otf'],
  )
})

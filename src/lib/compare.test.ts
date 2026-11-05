import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDroppedFiles,
  automaticFace,
  emptyCompare,
  familyIdForName,
  replaceCompareFamilies,
  type CompareFace,
  type CompareFamily,
} from '../../shared/compare.ts'
import { compareDropPaths } from './compare.ts'

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

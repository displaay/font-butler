import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { parseFontFile, resolveFamilyNames } from './parse.ts'

test('resolveFamilyNames prefers typographic family and style', () => {
  assert.deepEqual(
    resolveFamilyNames({
      familyName: 'Booton ExtraLight',
      subfamilyName: 'Italic',
      preferredFamily: 'Booton',
      preferredSubfamily: 'ExtraLight Italic',
    }),
    { familyName: 'Booton', styleName: 'ExtraLight Italic' },
  )
})

test('resolveFamilyNames falls back to name ID 1/2', () => {
  assert.deepEqual(
    resolveFamilyNames({
      familyName: 'Booton',
      subfamilyName: 'Bold',
    }),
    { familyName: 'Booton', styleName: 'Bold' },
  )
})

test('parseFontFile groups Booton OTFs under the typographic family', (t) => {
  const dir =
    '/Users/danielquisek/git/ms-office-safe-export/artifacts/test-fonts/Booton/Desktop package (OTF, TTF)/OTF'
  if (!fs.existsSync(dir)) {
    t.skip('Booton test fonts are not on this machine')
    return
  }
  const files = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.otf'))
  assert.equal(files.length, 16)
  const parsed = files.map((name) => ({
    name,
    ...parseFontFile(path.join(dir, name)).faces[0],
  }))
  assert.deepEqual([...new Set(parsed.map((face) => face.familyName))], ['Booton'])
  assert.deepEqual(
    parsed
      .map((face) => face.styleName)
      .sort((a, b) => a.localeCompare(b)),
    [
      'Bold',
      'Bold Italic',
      'ExtraLight',
      'ExtraLight Italic',
      'Heavy',
      'Heavy Italic',
      'Italic',
      'Light',
      'Light Italic',
      'Medium',
      'Medium Italic',
      'Regular',
      'SemiBold',
      'SemiBold Italic',
      'Thin',
      'Thin Italic',
    ],
  )
})

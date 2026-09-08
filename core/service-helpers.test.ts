import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayEntry, displayEntryLabel, displayFamily } from './service-helpers.ts'
import type { CatalogEntry, FontFaceInfo } from './types.ts'

function face(styleName: string, familyName = 'Fenul'): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName.replace(/\s+/g, '')}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: /italic/i.test(styleName),
  }
}

function entry(partial: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'fenul-regular',
    sourcePath: '/Fonts/Fenul/Fenul-Regular.otf',
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [face('Regular')],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

test('displayFamily uses the custom or face family name', () => {
  assert.equal(displayFamily(entry()), 'Fenul')
  assert.equal(displayFamily(entry({ customFamilyName: 'Display' })), 'Display')
})

test('displayEntry names the style and format', () => {
  assert.equal(displayEntry(entry()), 'Regular · OTF')
  assert.equal(
    displayEntry(entry({
      id: 'fenul-bold',
      sourcePath: '/Fonts/Fenul/Fenul-Bold.ttf',
      format: 'ttf',
      faces: [face('Bold')],
    })),
    'Bold · TTF',
  )
})

test('displayEntry summarizes collections instead of listing every style', () => {
  assert.equal(
    displayEntry(
      entry({
        sourcePath: '/Fonts/Fenul/Fenul.ttc',
        format: 'ttc',
        faces: ['Regular', 'Italic', 'Bold', 'Bold Italic'].map((style) => face(style)),
      }),
    ),
    '4 styles · TTC',
  )
})

test('displayEntry falls back to format when the file path is missing', () => {
  assert.equal(
    displayEntry(entry({ sourcePath: '', installedPath: undefined, disabledPath: undefined })),
    'Regular · OTF',
  )
})

test('displayEntryLabel works from import-plan fields', () => {
  assert.equal(
    displayEntryLabel({
      familyName: 'Fenul',
      faces: [face('Light Italic')],
      format: 'otf',
      filePath: '/Inbox/Fenul-LightItalic.otf',
    }),
    'Light Italic · OTF',
  )
})

test('displayEntryLabel strips generated prefixes when the style is missing', () => {
  assert.equal(
    displayEntryLabel({
      familyName: 'Fenul',
      faces: [],
      format: 'ttf',
      filePath: '/uploads/1788535075094-Fenul-CondensedLightItalic.ttf',
    }),
    'Fenul · Fenul-CondensedLightItalic.ttf',
  )
})

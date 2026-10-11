import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  catalogHoverInstanceRows,
  catalogInstanceRows,
  instanceRowVariation,
  systemInstanceRows,
  variationSettings,
} from './instances.ts'
import { facesMatchingRestCut, facesSupportVariationInterpolation } from './variationInterpolation.ts'
import { groupCatalog } from './group.ts'
import type { CatalogEntry, FamilyGroup, FontFaceInfo, SystemFace } from './types.ts'

function vfFace(): FontFaceInfo {
  return {
    familyName: 'Recoleta',
    styleName: 'Regular',
    fullName: 'Recoleta Regular',
    postscriptName: 'Recoleta-Regular',
    isVariable: true,
    instanceCount: 3,
    instanceNames: ['Light', 'Regular', 'Bold'],
    namedInstances: [
      { name: 'Light', coordinates: { wght: 300 } },
      { name: 'Regular', coordinates: { wght: 400 } },
      { name: 'Bold', coordinates: { wght: 700 } },
    ],
    weight: 400,
    italic: false,
  }
}

function group(face: FontFaceInfo): FamilyGroup {
  const entry: CatalogEntry = {
    id: 'vf',
    sourcePath: '/tmp/Recoleta.ttf',
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'uninstalled',
    faces: [face],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
  }
  return {
    key: 'Recoleta',
    familyName: 'Recoleta',
    entries: [entry],
    faces: [face],
    isVariable: true,
    instanceCount: 3,
    status: 'uninstalled',
    previewEntryId: 'vf',
    addedAt: 1,
  }
}

test('variationSettings serializes axis tags for CSS', () => {
  assert.equal(variationSettings({ wght: 300, opsz: 12 }), "'wght' 300, 'opsz' 12")
  assert.equal(variationSettings({}), undefined)
})

test('variable-font instance rows carry named-instance variation settings', () => {
  const rows = catalogInstanceRows(group(vfFace()))
  assert.equal(rows.length, 3)
  assert.deepEqual(
    rows.map((row) => row.variation),
    ["'wght' 300", "'wght' 400", "'wght' 700"],
  )
  assert.deepEqual(
    rows.map((row) => row.weight),
    [300, 400, 700],
  )
  assert.deepEqual(
    rows.map((row) => [row.format, row.installState, row.hasSource, row.macosCopy, row.adobeCopy]),
    [
      [undefined, undefined, true, undefined, undefined],
      [undefined, undefined, true, undefined, undefined],
      [undefined, undefined, true, undefined, undefined],
    ],
  )
})

test('variable-font instance rows fall back to wght when namedInstances are missing', () => {
  const face: FontFaceInfo = {
    ...vfFace(),
    namedInstances: undefined,
  }
  const rows = catalogInstanceRows(group(face))
  assert.deepEqual(
    rows.map((row) => row.variation),
    ["'wght' 300", "'wght' 400", "'wght' 700"],
  )
  assert.equal(instanceRowVariation(face, 'Bold'), "'wght' 700")
})

test('roman and italic variable files hover-morph the upright preview cut', () => {
  const romanFace = vfFace()
  const italicFace: FontFaceInfo = {
    ...vfFace(),
    styleName: 'Italic',
    fullName: 'Recoleta Italic',
    postscriptName: 'Recoleta-Italic',
    instanceNames: ['Italic', 'Bold Italic'],
    namedInstances: [
      { name: 'Italic', coordinates: { wght: 400 } },
      { name: 'Bold Italic', coordinates: { wght: 700 } },
    ],
    italic: true,
  }
  const roman: CatalogEntry = {
    id: 'roman',
    sourcePath: '/tmp/Recoleta-Roman.ttf',
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [romanFace],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    installedPath: '/Library/Fonts/Recoleta-Roman.ttf',
  }
  const italic: CatalogEntry = {
    ...roman,
    id: 'italic',
    sourcePath: '/tmp/Recoleta-Italic.ttf',
    faces: [italicFace],
    installedPath: '/Library/Fonts/Recoleta-Italic.ttf',
  }
  const grouped = groupCatalog([roman, italic])[0]!
  assert.equal(grouped.previewEntryId, 'roman')
  const rows = catalogInstanceRows(grouped)
  assert.equal(rows.length, 5)
  const mixed = rows.map((row) => ({
    family: `fc-${row.catalogEntryId}`,
    italic: row.italic,
    variation: row.variation,
  }))
  assert.equal(facesSupportVariationInterpolation(mixed), false)
  const hoverRows = catalogHoverInstanceRows(grouped)
  assert.deepEqual(
    hoverRows.map((row) => [row.catalogEntryId, row.label, row.italic, row.variation]),
    [
      ['roman', 'Light', false, "'wght' 300"],
      ['roman', 'Regular', false, "'wght' 400"],
      ['roman', 'Bold', false, "'wght' 700"],
    ],
  )
  const faces = hoverRows.map((row) => ({
    family: `fc-${row.catalogEntryId}`,
    italic: row.italic,
    variation: row.variation,
  }))
  const rest = faces.find((face) => face.variation === "'wght' 400")!
  assert.equal(facesSupportVariationInterpolation(facesMatchingRestCut(faces, rest)), true)
})

test('catalog hover preview keeps only the single VF entry when static retail cuts share the family', () => {
  const vf: FontFaceInfo = {
    ...vfFace(),
    postscriptName: 'AguzzoVF',
    familyName: 'Aguzzo VF',
  }
  const vfEntry: CatalogEntry = {
    id: 'vf',
    sourcePath: '/cache/AguzzoVF.ttf',
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [vf],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    retailRelativePath: 'Aguzzo/AguzzoVF.ttf',
    retailFamilyName: 'Aguzzo VF',
    installedPath: '/Library/Fonts/AguzzoVF.ttf',
  }
  const staticEntry = {
    ...vfEntry,
    id: 'static',
    retailRelativePath: 'Aguzzo/Aguzzo-Bold.otf',
    faces: [staticFace('Aguzzo VF', 'Bold')],
    format: 'otf',
  }
  const grouped = groupCatalog([vfEntry, staticEntry])[0]!
  const rows = catalogInstanceRows(grouped)
  assert.equal(rows.length, 4)
  const hoverRows = catalogHoverInstanceRows(grouped)
  assert.equal(hoverRows.length, 3)
  assert.ok(hoverRows.every((row) => row.catalogEntryId === 'vf'))
})

function variableEntry(
  id: string,
  face: FontFaceInfo,
  extra: Partial<CatalogEntry> = {},
): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${id}.ttf`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [face],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
    installedPath: `/Library/Fonts/${id}.ttf`,
    ...extra,
  }
}

function assertHoverMorphs(rows: ReturnType<typeof catalogHoverInstanceRows>, sample: string) {
  assert.ok(rows.length >= 2)
  assert.ok(rows.every((row) => row.previewSample === sample))
  assert.equal(new Set(rows.map((row) => row.catalogEntryId)).size, 1)
  assert.equal(new Set(rows.map((row) => row.widthClass)).size, 1)
  const faces = rows.map((row) => ({
    family: `fc-${row.catalogEntryId}`,
    italic: row.italic,
    widthClass: row.widthClass,
    variation: row.variation,
  }))
  assert.equal(facesSupportVariationInterpolation(facesMatchingRestCut(faces, faces[0]!)), true)
}

test('a multi-width family hovers only the resting width and keeps its preview text', () => {
  const condensed = variableEntry('bagoss-condensed', {
    familyName: 'Bagoss',
    styleName: 'Condensed Regular',
    fullName: 'Bagoss Condensed Regular',
    postscriptName: 'Bagoss-CondensedRegular',
    isVariable: true,
    instanceCount: 2,
    instanceNames: ['Condensed Regular', 'Condensed Medium'],
    namedInstances: [
      { name: 'Condensed Regular', coordinates: { wght: 400, wdth: 75 } },
      { name: 'Condensed Medium', coordinates: { wght: 500, wdth: 75 } },
    ],
    weight: 400,
    italic: false,
  }, { previewSample: 'Aa' })
  const normal = variableEntry('bagoss', {
    familyName: 'Bagoss',
    styleName: 'Regular',
    fullName: 'Bagoss Regular',
    postscriptName: 'Bagoss-Regular',
    isVariable: true,
    instanceCount: 2,
    instanceNames: ['Regular', 'Medium'],
    namedInstances: [
      { name: 'Regular', coordinates: { wght: 400, wdth: 100 } },
      { name: 'Medium', coordinates: { wght: 500, wdth: 100 } },
    ],
    weight: 400,
    italic: false,
  }, { previewSample: 'ACi' })
  const grouped = groupCatalog([condensed, normal])[0]!
  assert.equal(grouped.previewEntryId, 'bagoss-condensed')
  const mixed = catalogInstanceRows(grouped)
  assert.ok(mixed.some((row) => row.previewSample === 'ACi'))
  const hoverRows = catalogHoverInstanceRows(grouped)
  assert.deepEqual(
    hoverRows.map((row) => [row.catalogEntryId, row.label, row.widthClass, row.previewSample]),
    [
      ['bagoss-condensed', 'Condensed Regular', 'condensed', 'Aa'],
      ['bagoss-condensed', 'Condensed Medium', 'condensed', 'Aa'],
    ],
  )
  assertHoverMorphs(hoverRows, 'Aa')

  const condensedFace = condensed.faces[0]!
  const normalFace = normal.faces[0]!
  const oneFile = variableEntry('bagoss-file', condensedFace, { previewSample: 'Aa' })
  oneFile.faces = [condensedFace, normalFace]
  const single = groupCatalog([oneFile])[0]!
  const singleHover = catalogHoverInstanceRows(single)
  assert.deepEqual(
    singleHover.map((row) => row.label),
    ['Condensed Regular', 'Condensed Medium'],
  )
  assertHoverMorphs(singleHover, 'Aa')

  const mixedFace: FontFaceInfo = {
    familyName: 'Bagoss',
    styleName: 'Regular',
    fullName: 'Bagoss',
    postscriptName: 'Bagoss-VF',
    isVariable: true,
    instanceCount: 4,
    instanceNames: ['Condensed Regular', 'Condensed Medium', 'Regular', 'Medium'],
    namedInstances: [
      { name: 'Condensed Regular', coordinates: { wght: 400, wdth: 75 } },
      { name: 'Condensed Medium', coordinates: { wght: 500, wdth: 75 } },
      { name: 'Regular', coordinates: { wght: 400, wdth: 100 } },
      { name: 'Medium', coordinates: { wght: 500, wdth: 100 } },
    ],
    weight: 400,
    italic: false,
  }
  const mixedHover = catalogHoverInstanceRows(groupCatalog([variableEntry('bagoss-mixed', mixedFace, { previewSample: 'Aa' })])[0]!)
  assert.deepEqual(
    mixedHover.map((row) => [row.label, row.widthClass, row.previewSample]),
    [
      ['Condensed Regular', 'condensed', 'Aa'],
      ['Condensed Medium', 'condensed', 'Aa'],
    ],
  )
  assertHoverMorphs(mixedHover, 'Aa')
})

test('a family with several variable files hovers only the card file and keeps its preview text', () => {
  const coolkit = variableEntry('coolkit', {
    familyName: 'Coolkit VF',
    styleName: 'Regular',
    fullName: 'Coolkit VF Regular',
    postscriptName: 'CoolkitVF-Regular',
    isVariable: true,
    instanceCount: 2,
    instanceNames: ['Light', 'Regular'],
    namedInstances: [
      { name: 'Light', coordinates: { wght: 300 } },
      { name: 'Regular', coordinates: { wght: 400 } },
    ],
    weight: 400,
    italic: false,
  }, { previewSample: 'Aa' })
  const other = variableEntry('coolkit-display', {
    familyName: 'Coolkit VF',
    styleName: 'Display',
    fullName: 'Coolkit VF Display',
    postscriptName: 'CoolkitVF-Display',
    isVariable: true,
    instanceCount: 2,
    instanceNames: ['Light', 'Regular'],
    namedInstances: [
      { name: 'Light', coordinates: { wght: 300, opsz: 72 } },
      { name: 'Regular', coordinates: { wght: 400, opsz: 72 } },
    ],
    weight: 400,
    italic: false,
  }, { previewSample: 'ACi' })
  const grouped = groupCatalog([coolkit, other])[0]!
  assert.equal(grouped.previewEntryId, 'coolkit')
  const hoverRows = catalogHoverInstanceRows(grouped)
  assert.deepEqual(
    hoverRows.map((row) => [row.catalogEntryId, row.label, row.previewSample, row.variation]),
    [
      ['coolkit', 'Light', 'Aa', "'wght' 300"],
      ['coolkit', 'Regular', 'Aa', "'wght' 400"],
    ],
  )
  assertHoverMorphs(hoverRows, 'Aa')
  assert.equal(hoverRows.some((row) => row.previewSample === 'ACi'), false)
})

test('an italic-only variable file still hover-morphs that italic cut', () => {
  const italic = variableEntry('concrette-italic', {
    familyName: 'Concrette Italic',
    styleName: 'Italic',
    fullName: 'Concrette Italic',
    postscriptName: 'ConcretteItalic-Italic',
    isVariable: true,
    instanceCount: 2,
    instanceNames: ['Light Italic', 'Bold Italic'],
    namedInstances: [
      { name: 'Light Italic', coordinates: { wght: 300 } },
      { name: 'Bold Italic', coordinates: { wght: 700 } },
    ],
    weight: 400,
    italic: true,
  }, { previewSample: 'Aa' })
  const grouped = groupCatalog([italic])[0]!
  const hoverRows = catalogHoverInstanceRows(grouped)
  assert.deepEqual(
    hoverRows.map((row) => [row.label, row.italic, row.previewSample]),
    [
      ['Light Italic', true, 'Aa'],
      ['Bold Italic', true, 'Aa'],
    ],
  )
  assertHoverMorphs(hoverRows, 'Aa')
})

function staticFace(familyName: string, styleName: string, italic = false): FontFaceInfo {
  return {
    familyName,
    styleName,
    fullName: `${familyName} ${styleName}`,
    postscriptName: `${familyName}-${styleName.replace(/\s+/g, '')}`,
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: italic ? 400 : styleName.toLowerCase().includes('bold') ? 700 : 400,
    italic,
  }
}

function staticEntry(
  id: string,
  styleName: string,
  status: CatalogEntry['status'],
  extra: Partial<CatalogEntry> = {},
): CatalogEntry {
  const italic = /italic/i.test(styleName)
  return {
    id,
    sourcePath: `/tmp/${id}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status,
    faces: [staticFace('Plex', styleName, italic)],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

test('instance rows carry the family preview sample', () => {
  const groups = groupCatalog([
    staticEntry('on', 'Regular', 'installed', { previewSample: 'א' }),
  ])
  assert.equal(catalogInstanceRows(groups[0]!)[0]?.previewSample, 'א')
})

test('catalog instance rows keep live vs inactive styles when the source is missing', () => {
  const groups = groupCatalog([
    staticEntry('on', 'Regular', 'installed', {
      sourceAvailability: 'missing',
      installedPath: '/tmp/Fonts/on.otf',
      installations: [
        { destinationId: 'macos', path: '/tmp/Fonts/on.otf', verification: 'file-present' },
      ],
    }),
    staticEntry('off', 'Italic', 'deactivated', { sourceAvailability: 'missing' }),
    staticEntry('gone', 'Bold', 'source-missing', { sourceAvailability: 'missing' }),
  ])
  assert.equal(groups.length, 1)
  const rows = catalogInstanceRows(groups[0]!)
  assert.deepEqual(
    rows.map((row) => [row.label, row.installState, row.macosCopy, row.adobeCopy]),
    [
      ['Regular', 'installed', true, false],
      ['Italic', 'deactivated', false, false],
      ['Bold', 'uninstalled', false, false],
    ],
  )
  assert.deepEqual(
    rows.map((row) => row.format),
    ['otf', 'otf', 'otf'],
  )
  assert.deepEqual(
    rows.map((row) => row.hasSource),
    [true, true, false],
  )
})

test('retail-synced instance rows carry the Displaay source instead of a disk source', () => {
  const groups = groupCatalog([
    staticEntry('retail', 'Regular', 'installed', {
      retailRelativePath: 'Plex/Plex-Regular.otf',
      retailFamilyName: 'Plex',
      sourcePresent: false,
      installedPath: '/tmp/Fonts/Plex-Regular.otf',
    }),
  ])
  const rows = catalogInstanceRows(groups[0]!, {
    enabled: true,
    fonts: [{ familyName: 'Plex', enabled: true }],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.retailSynced, true)
  assert.equal(rows[0]?.hasSource, false)
})

test('retail instance rows hide the Displaay mark when sync is off', () => {
  const groups = groupCatalog([
    staticEntry('retail', 'Regular', 'installed', {
      retailRelativePath: 'Plex/Plex-Regular.otf',
      retailFamilyName: 'Plex',
      sourcePresent: false,
      installedPath: '/tmp/Fonts/Plex-Regular.otf',
    }),
  ])
  const off = catalogInstanceRows(groups[0]!, {
    enabled: false,
    fonts: [{ familyName: 'Plex', enabled: true }],
  })
  assert.equal(off[0]?.retailSynced, false)
  const disabledFamily = catalogInstanceRows(groups[0]!, {
    enabled: true,
    fonts: [{ familyName: 'Plex', enabled: false }],
    disabledGlyphsFiles: ['Plex'],
  })
  assert.equal(disabledFamily[0]?.retailSynced, false)
})

test('system variable-font instance rows omit format and computer tags', () => {
  const face: SystemFace = {
    path: '/System/RecoletaVF.ttf',
    familyName: 'Recoleta',
    styleName: 'Regular',
    fullName: 'Recoleta Regular',
    postscriptName: 'Recoleta-Regular',
    isVariable: true,
    instanceCount: 2,
    instanceNames: ['Light', 'Bold'],
    weight: 400,
    italic: false,
    format: 'ttf',
    protected: false,
    writable: true,
    deactivated: false,
  }
  const rows = systemInstanceRows({
    key: 'Recoleta',
    familyName: 'Recoleta',
    faces: [face],
    isVariable: true,
    instanceCount: 2,
    protected: false,
    writable: true,
  })
  assert.deepEqual(
    rows.map((row) => [row.label, row.format, row.installState, row.macosCopy]),
    [
      ['Light', undefined, undefined, undefined],
      ['Bold', undefined, undefined, undefined],
    ],
  )
})

test('system instance rows mark deactivated faces separately from live ones', () => {
  const face = (styleName: string, deactivated = false): SystemFace => ({
    path: `/System/${styleName}.otf`,
    familyName: 'System Sans',
    styleName,
    fullName: `System Sans ${styleName}`,
    postscriptName: `SystemSans-${styleName}`,
    isVariable: false,
    instanceCount: 1,
    weight: 400,
    italic: false,
    format: 'otf',
    protected: false,
    writable: true,
    deactivated,
  })
  const rows = systemInstanceRows({
    key: 'System Sans',
    familyName: 'System Sans',
    faces: [face('Regular'), face('Light', true)],
    isVariable: false,
    instanceCount: 2,
    protected: false,
    writable: true,
  })
  assert.deepEqual(
    rows.map((row) => [row.label, row.installState, row.format, row.macosCopy]),
    [
      ['Regular', 'installed', 'otf', true],
      ['Light', 'deactivated', 'otf', false],
    ],
  )
})

test('catalog instance rows tag each file format', () => {
  const groups = groupCatalog([
    staticEntry('otf', 'Regular', 'installed', {
      format: 'otf',
      sourcePath: '/tmp/otf.otf',
      installedPath: '/Library/Fonts/otf.otf',
    }),
    staticEntry('ttf', 'Regular', 'installed', {
      format: 'ttf',
      sourcePath: '/tmp/ttf.ttf',
      faces: [staticFace('Plex', 'Regular')],
      installedPath: '/Library/Fonts/ttf.ttf',
      installations: [
        { destinationId: 'macos', path: '/Library/Fonts/ttf.ttf', verification: 'file-present' },
        {
          destinationId: 'adobe-shared',
          path: '/tmp/adobe/ttf.ttf',
          verification: 'file-present',
        },
      ],
    }),
  ])
  const rows = catalogInstanceRows(groups[0]!)
  assert.deepEqual(
    rows.map((row) => [row.label, row.format, row.installState, row.macosCopy, row.adobeCopy]),
    [
      ['Regular', 'otf', 'installed', true, false],
      ['Regular', 'ttf', 'installed', true, true],
    ],
  )
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { test } from 'node:test'
import { Hono } from 'hono'
import { reportDocumentFonts, type DocumentFontReport } from './document-fonts.ts'
import { documentProjectDraft } from './document-project.ts'
import { mountDocumentFontsRoute } from '../server/document-fonts-route.ts'
import type { CatalogEntry, FontStatus } from './types.ts'

test('pdf BaseFont strips a subset prefix and classifies on, off, and missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-pdf-'))
  try {
    const pdf = path.join(dir, 'Sample.pdf')
    fs.writeFileSync(
      pdf,
      [
        '%PDF-1.4',
        '1 0 obj',
        '<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Family-Bold >>',
        'endobj',
        '2 0 obj',
        '<< /Type /Font /Subtype /TrueType /BaseFont /Family-Regular >>',
        'endobj',
        '3 0 obj',
        '<< /Type /Font /Subtype /Type1 /BaseFont /NotInLibrary-Regular >>',
        'endobj',
        '4 0 obj',
        '<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Family-Bold >>',
        'endobj',
        'trailer << >>',
        '%%EOF',
        '',
      ].join('\n'),
    )
    const report = reportDocumentFonts(pdf, [
      catalogEntry({
        id: 'bold',
        postscriptName: 'Family-Bold',
        familyName: 'Family',
        styleName: 'Bold',
        status: 'installed',
        installedFingerprint: 'fp-bold',
      }),
      catalogEntry({
        id: 'regular',
        postscriptName: 'Family-Regular',
        familyName: 'Family',
        styleName: 'Regular',
        status: 'deactivated',
        installedFingerprint: 'fp-regular',
      }),
    ])
    assert.equal(report.kind, 'pdf')
    assert.equal(report.path, path.resolve(pdf))
    assert.deepEqual(
      report.fonts.map((font) => font.postscriptName),
      ['Family-Bold', 'Family-Regular', 'NotInLibrary-Regular'],
    )
    assert.equal(report.fonts[0]?.status, 'on')
    assert.equal(report.fonts[0]?.assetId, 'bold')
    assert.equal(report.fonts[0]?.installedFingerprint, 'fp-bold')
    assert.equal(report.fonts[0]?.matchedBy, 'postscript')
    assert.equal(report.fonts[1]?.status, 'in-library-off')
    assert.equal(report.fonts[1]?.assetId, 'regular')
    assert.equal(report.fonts[1]?.installedFingerprint, undefined)
    assert.equal(report.fonts[2]?.status, 'missing')
    assert.equal(report.fonts[2]?.assetId, undefined)
    assert.equal(report.fonts[2]?.installedFingerprint, undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('pdf reads BaseFont names from a FlateDecode stream, including a hex escape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-flate-'))
  try {
    const pdf = path.join(dir, 'Compressed.pdf')
    const bytes = pdfWithFlateBaseFont('ABCDEF+Family#2DBold')
    assert.equal(bytes.includes(Buffer.from('/BaseFont')), false)
    fs.writeFileSync(pdf, bytes)
    const report = reportDocumentFonts(pdf, [
      catalogEntry({
        id: 'bold',
        postscriptName: 'Family-Bold',
        familyName: 'Family',
        styleName: 'Bold',
        status: 'outdated',
        installedFingerprint: 'fp-live',
      }),
    ])
    assert.equal(report.fonts.length, 1)
    assert.equal(report.fonts[0]?.postscriptName, 'Family-Bold')
    assert.equal(report.fonts[0]?.status, 'on')
    assert.equal(report.fonts[0]?.installedFingerprint, 'fp-live')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('idml snippet matches PostScript name, then family and style, and does not pin a different cut', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-idml-'))
  try {
    const snippet = path.join(dir, 'Snippet.idml')
    fs.writeFileSync(snippet, idmlFontsXml())
    const report = reportDocumentFonts(snippet, idmlCatalog())
    assertIdmlClassification(report)

    const zipped = path.join(dir, 'Package.idml')
    fs.writeFileSync(
      zipped,
      zipPackage([
        { name: 'mimetype', data: Buffer.from('application/vnd.adobe.indesign-idml-package') },
        { name: 'Resources/Fonts.xml', data: Buffer.from(idmlFontsXml()) },
      ]),
    )
    assertIdmlClassification(reportDocumentFonts(zipped, idmlCatalog()))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('indd and indt read the first XMP font list and ignore a later packet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-indd-'))
  try {
    const indd = path.join(dir, 'Book.indd')
    fs.writeFileSync(indd, indesignWithXmp())
    const report = reportDocumentFonts(indd, [
      catalogEntry({
        id: 'regular',
        postscriptName: 'MinionPro-Regular',
        familyName: 'Minion Pro',
        styleName: 'Regular',
        status: 'installed',
        installedFingerprint: 'fp-minion',
      }),
      catalogEntry({
        id: 'bold',
        postscriptName: 'Family-Bold',
        familyName: 'Family',
        styleName: 'Bold',
        status: 'deactivated',
      }),
    ])
    assert.equal(report.kind, 'indd')
    assert.deepEqual(
      report.fonts.map((font) => [font.postscriptName, font.familyName, font.styleName, font.status, font.assetId]),
      [
        ['MinionPro-Regular', 'Minion Pro', 'Regular', 'on', 'regular'],
        ['Family-Bold', 'Family', 'Bold', 'in-library-off', 'bold'],
        ['Ampersand-Regular', 'A & B', 'Regular', 'missing', undefined],
      ],
    )
    assert.equal(report.fonts[0]?.installedFingerprint, 'fp-minion')
    assert.equal(report.fonts.some((font) => font.postscriptName === 'Ignored-Face'), false)

    const template = path.join(dir, 'Book.indt')
    fs.writeFileSync(template, indesignWithXmp())
    assert.equal(reportDocumentFonts(template, []).kind, 'indd')
    assert.equal(reportDocumentFonts(template, []).fonts.length, 3)

    const empty = path.join(dir, 'Empty.indd')
    fs.writeFileSync(empty, Buffer.from('DOCUMENT\0no font list', 'utf8'))
    assert.deepEqual(reportDocumentFonts(empty, []).fonts, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('illustrator combines PDF font names with XMP and fills in family and style', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-ai-'))
  try {
    const ai = path.join(dir, 'Mark.ai')
    const pdf = [
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+MinionPro-Regular-Identity-H /DescendantFonts [2 0 R] >>',
      'endobj',
      '3 0 obj',
      '<< /Type /Font /BaseFont /Arial,Bold >>',
      'endobj',
      '%%EOF',
    ].join('\n')
    fs.writeFileSync(ai, Buffer.concat([Buffer.from(pdf), Buffer.from(indesignWithXmp())]))
    const report = reportDocumentFonts(ai, [
      catalogEntry({
        id: 'regular',
        postscriptName: 'MinionPro-Regular',
        familyName: 'Minion Pro',
        styleName: 'Regular',
        status: 'installed',
        installedFingerprint: 'fp-minion',
      }),
    ])
    assert.equal(report.kind, 'ai')
    assert.deepEqual(
      report.fonts.map((font) => [font.postscriptName, font.familyName, font.styleName, font.status]),
      [
        ['MinionPro-Regular', 'Minion Pro', 'Regular', 'on'],
        ['Arial,Bold', 'Arial', 'Bold', 'missing'],
        ['Family-Bold', 'Family', 'Bold', 'missing'],
        ['Ampersand-Regular', 'A & B', 'Regular', 'missing'],
      ],
    )
    assert.equal(report.fonts[0]?.installedFingerprint, 'fp-minion')
    assert.equal(report.fonts[0]?.matchedBy, 'postscript')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('photoshop text layers name the fonts a run uses, including a large document', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-psd-'))
  try {
    const psd = path.join(dir, 'Poster.psd')
    const engine = Buffer.from(
      '/StyleRun << /RunArray [ << /StyleSheet << /StyleSheetData << /Font 0 >> >> >> << /StyleSheet << /StyleSheetData << /Font 1 >> >> >> << /StyleSheet << /StyleSheetData << /Font 2 >> >> >> ] /RunLengthArray [ 4 2 1 ] >> /ResourceDict << /FontSet [ << /Name (Family-Regular) >> << /Name (Family\\(Bold\\)) >> << /Name (AdobeInvisFont) >> ] >>',
      'latin1',
    )
    fs.writeFileSync(psd, photoshopFile(engine, 1))
    const report = reportDocumentFonts(psd, [
      catalogEntry({
        id: 'regular',
        postscriptName: 'Family-Regular',
        familyName: 'Family',
        styleName: 'Regular',
        status: 'installed',
        installedFingerprint: 'fp-regular',
      }),
    ])
    assert.equal(report.kind, 'psd')
    assert.deepEqual(
      report.fonts.map((font) => [font.postscriptName, font.status, font.assetId]),
      [
        ['Family-Regular', 'on', 'regular'],
        ['Family(Bold)', 'missing', undefined],
      ],
    )

    const fallback = path.join(dir, 'Fallback.psb')
    fs.writeFileSync(
      fallback,
      photoshopFile(
        '/StyleRun << /RunLengthArray [ 3 ] >> /ResourceDict << /StyleSheetSet [ << /Font 1 >> ] /FontSet [ << /Name (NotUsed-Regular) >> << /Name (Family-Bold) >> << /Name (AdobeInvisFont) >> ] >>',
        2,
      ),
    )
    const large = reportDocumentFonts(fallback, [])
    assert.equal(large.kind, 'psd')
    assert.deepEqual(
      large.fonts.map((font) => font.postscriptName),
      ['Family-Bold'],
    )

    const utf = path.join(dir, 'Utf.psd')
    fs.writeFileSync(
      utf,
      photoshopFile(
        Buffer.concat([
          Buffer.from('/StyleRun << /Font 0 /RunLengthArray [ 2 ] >> /ResourceDict << /FontSet [ << /Name (', 'latin1'),
          Buffer.from([0xfe, 0xff, 0x00, 0x4d, 0x00, 0x69, 0x00, 0x6e]),
          Buffer.from(') >> ] >>', 'latin1'),
        ]),
        1,
      ),
    )
    assert.deepEqual(
      reportDocumentFonts(utf, []).fonts.map((font) => font.postscriptName),
      ['Min'],
    )

    const junk = path.join(dir, 'Junk.psd')
    fs.writeFileSync(junk, Buffer.from('not a photoshop file'))
    assert.throws(() => reportDocumentFonts(junk, []), /Could not read that Photoshop file/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a live InDesign font list is classified without a file', async () => {
  const app = new Hono()
  mountDocumentFontsRoute(app, () => [
    catalogEntry({
      id: 'regular',
      postscriptName: 'Family-Regular',
      familyName: 'Family',
      styleName: 'Regular',
      status: 'deactivated',
    }),
  ])
  const response = await app.request('/api/documents/fonts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fonts: [
        { postscriptName: 'Family-Regular', familyName: 'Family', styleName: '' },
        { postscriptName: 'Missing-Face', familyName: 'Missing', styleName: 'Regular' },
      ],
    }),
  })
  assert.equal(response.status, 200)
  const body = (await response.json()) as DocumentFontReport
  assert.equal(body.kind, 'indd')
  assert.equal(body.live, true)
  assert.equal(body.path, 'InDesign')
  assert.equal(body.fonts[0]?.status, 'in-library-off')
  assert.equal(body.fonts[0]?.assetId, 'regular')
  assert.equal(body.fonts[0]?.styleName, '')
  assert.equal(body.fonts[1]?.status, 'missing')
})

test('a lowercase plus tag is not a subset prefix, and an active duplicate wins', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-prefix-'))
  try {
    const pdf = path.join(dir, 'Prefix.pdf')
    fs.writeFileSync(
      pdf,
      '%PDF-1.4\n1 0 obj\n<< /BaseFont /abcdef+Family-Bold >>\nendobj\n%%EOF\n',
    )
    const report = reportDocumentFonts(pdf, [
      catalogEntry({
        id: 'off',
        postscriptName: 'abcdef+Family-Bold',
        familyName: 'Family',
        styleName: 'Bold',
        status: 'uninstalled',
      }),
      catalogEntry({
        id: 'on',
        postscriptName: 'abcdef+Family-Bold',
        familyName: 'Family',
        styleName: 'Bold',
        status: 'installed',
        installedFingerprint: 'fp-on',
      }),
    ])
    assert.equal(report.fonts.length, 1)
    assert.equal(report.fonts[0]?.postscriptName, 'abcdef+Family-Bold')
    assert.equal(report.fonts[0]?.assetId, 'on')
    assert.equal(report.fonts[0]?.status, 'on')
    assert.equal(report.fonts[0]?.installedFingerprint, 'fp-on')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/documents/fonts reports a file and does not require a project write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-api-'))
  try {
    const pdf = path.join(dir, 'Note.pdf')
    fs.writeFileSync(
      pdf,
      '%PDF-1.4\n1 0 obj\n<< /BaseFont /ABCDEF+Family-Bold >>\nendobj\n2 0 obj\n<< /BaseFont /Missing-Face >>\nendobj\n%%EOF\n',
    )
    let reads = 0
    const app = new Hono()
    mountDocumentFontsRoute(app, () => {
      reads += 1
      return [
        catalogEntry({
          id: 'bold',
          postscriptName: 'Family-Bold',
          familyName: 'Family',
          styleName: 'Bold',
          status: 'installed',
          installedFingerprint: 'fp-bold',
        }),
      ]
    })

    const missing = await app.request('/api/documents/fonts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(missing.status, 400)
    assert.equal(((await missing.json()) as { error?: string }).error, 'Missing path')

    const office = await app.request('/api/documents/fonts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(dir, 'Note.txt') }),
    })
    assert.equal(office.status, 400)
    assert.equal(
      ((await office.json()) as { error?: string }).error,
      'Document fonts can be read from PDF, IDML, InDesign, Illustrator, Photoshop, Word, and PowerPoint files.',
    )

    const response = await app.request('/api/documents/fonts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: pdf }),
    })
    assert.equal(response.status, 200)
    const body = (await response.json()) as DocumentFontReport
    assert.equal(body.kind, 'pdf')
    assert.equal(body.fonts[0]?.status, 'on')
    assert.equal(body.fonts[0]?.assetId, 'bold')
    assert.equal(body.fonts[1]?.status, 'missing')
    assert.equal(body.fonts[1]?.postscriptName, 'Missing-Face')
    assert.equal(reads, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('docx lists one installed family without pinning a style, and pptx shares that reader', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-doc-office-'))
  try {
    const catalog = officeCatalog()
    const docx = path.join(dir, 'Brief.docx')
    fs.writeFileSync(
      docx,
      zipPackage([{ name: 'word/document.xml', data: Buffer.from(officeDocumentXml()) }]),
    )
    const report = reportDocumentFonts(docx, catalog)
    assert.equal(report.kind, 'docx')
    assert.equal(report.path, path.resolve(docx))
    assert.deepEqual(report.fonts.map(officeFontFields), [
      {
        postscriptName: '',
        familyName: 'Family',
        styleName: '',
        status: 'on',
        assetIds: ['regular'],
        matchedBy: 'family',
      },
      {
        postscriptName: '',
        familyName: 'Family',
        styleName: '',
        status: 'in-library-off',
        assetIds: ['bold'],
        matchedBy: 'family',
      },
      {
        postscriptName: '',
        familyName: 'Not In Library',
        styleName: '',
        status: 'missing',
      },
    ])
    const draft = documentProjectDraft(report)
    assert.deepEqual(draft.memberIds, ['regular', 'bold'])
    assert.deepEqual(draft.pins, {})
    assert.deepEqual(draft.unresolved, [
      {
        postscriptName: '',
        familyName: 'Not In Library',
        styleName: '',
        sourceFile: path.resolve(docx),
      },
    ])

    const pptx = path.join(dir, 'Deck.pptx')
    fs.writeFileSync(
      pptx,
      zipPackage([{ name: 'ppt/slides/slide1.xml', data: Buffer.from(officeSlideXml()) }]),
    )
    const slides = reportDocumentFonts(pptx, catalog)
    assert.equal(slides.kind, 'pptx')
    assert.deepEqual(slides.fonts.map(officeFontFields), report.fonts.map(officeFontFields))

    const pair = path.join(dir, 'Pair.docx')
    fs.writeFileSync(
      pair,
      zipPackage([
        {
          name: 'word/document.xml',
          data: Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:rFonts w:ascii="Pair" w:hAnsi="Pair"/>
</w:document>
`,
          ),
        },
      ]),
    )
    const paired = reportDocumentFonts(pair, catalog)
    assert.deepEqual(paired.fonts.map(officeFontFields), [
      {
        postscriptName: '',
        familyName: 'Pair',
        styleName: '',
        status: 'on',
        assetIds: ['pair-regular', 'pair-bold'],
        matchedBy: 'family',
      },
    ])
    assert.deepEqual(documentProjectDraft(paired).pins, {})
    assert.deepEqual(documentProjectDraft(paired).memberIds, ['pair-regular', 'pair-bold'])

    const cut = path.join(dir, 'Cut.docx')
    fs.writeFileSync(
      cut,
      zipPackage([
        {
          name: 'word/document.xml',
          data: Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:rFonts w:hAnsi="Family-Bold"/>
</w:document>
`,
          ),
        },
      ]),
    )
    const exact = reportDocumentFonts(cut, catalog)
    assert.equal(exact.fonts.length, 1)
    assert.equal(exact.fonts[0]?.postscriptName, 'Family-Bold')
    assert.equal(exact.fonts[0]?.assetId, 'bold')
    assert.equal(exact.fonts[0]?.status, 'in-library-off')
    assert.equal(exact.fonts[0]?.matchedBy, 'postscript')
    assert.equal(exact.fonts[0]?.installedFingerprint, undefined)
    assert.equal(exact.fonts[0]?.assetIds, undefined)

    const solo = path.join(dir, 'Solo.pptx')
    fs.writeFileSync(
      solo,
      zipPackage([
        {
          name: 'ppt/slides/slide1.xml',
          data: Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:latin typeface="Solo"/>
</p:sld>
`,
          ),
        },
      ]),
    )
    const only = reportDocumentFonts(solo, catalog)
    assert.equal(only.kind, 'pptx')
    assert.equal(only.fonts.length, 1)
    assert.equal(only.fonts[0]?.familyName, 'Solo')
    assert.equal(only.fonts[0]?.assetId, 'solo')
    assert.equal(only.fonts[0]?.status, 'on')
    assert.equal(only.fonts[0]?.matchedBy, 'family-style')
    assert.equal(only.fonts[0]?.installedFingerprint, 'fp-solo')
    assert.deepEqual(documentProjectDraft(only).pins, { solo: 'fp-solo' })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function officeFontFields(font: DocumentFontReport['fonts'][number]) {
  return {
    postscriptName: font.postscriptName,
    familyName: font.familyName,
    styleName: font.styleName,
    status: font.status,
    ...(font.assetId ? { assetId: font.assetId } : {}),
    ...(font.assetIds ? { assetIds: font.assetIds } : {}),
    ...(font.installedFingerprint ? { installedFingerprint: font.installedFingerprint } : {}),
    ...(font.matchedBy ? { matchedBy: font.matchedBy } : {}),
  }
}

function officeCatalog(): CatalogEntry[] {
  return [
    catalogEntry({
      id: 'regular',
      postscriptName: 'Family-Regular',
      familyName: 'Family',
      styleName: 'Regular',
      status: 'installed',
      installedFingerprint: 'fp-regular',
    }),
    catalogEntry({
      id: 'bold',
      postscriptName: 'Family-Bold',
      familyName: 'Family',
      styleName: 'Bold',
      status: 'deactivated',
      installedFingerprint: 'fp-bold',
    }),
    catalogEntry({
      id: 'pair-regular',
      postscriptName: 'Pair-Regular',
      familyName: 'Pair',
      styleName: 'Regular',
      status: 'installed',
      installedFingerprint: 'fp-pair-regular',
    }),
    catalogEntry({
      id: 'pair-bold',
      postscriptName: 'Pair-Bold',
      familyName: 'Pair',
      styleName: 'Bold',
      status: 'installed',
      installedFingerprint: 'fp-pair-bold',
    }),
    catalogEntry({
      id: 'solo',
      postscriptName: 'Solo-Regular',
      familyName: 'Solo',
      styleName: 'Regular',
      status: 'installed',
      installedFingerprint: 'fp-solo',
    }),
  ]
}

function officeDocumentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:rPr>
    <w:rFonts w:ascii="Family" w:hAnsi="Family" w:cs="Family"/>
  </w:rPr>
  <w:rPr>
    <w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/>
  </w:rPr>
  <w:rPr>
    <w:rFonts w:ascii="Not In Library" w:eastAsia="Not In Library"/>
  </w:rPr>
  <w:cs w:val="22"/>
  <a:latin typeface="Family"/>
  <a:cs typeface="+mn-cs"/>
  <a:ea typeface=""/>
  <a:font script="Jpan" typeface="Should Not Read"/>
</w:document>
`
}

function officeSlideXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <a:latin typeface="Family"/>
  <a:cs typeface="Not In Library"/>
  <a:ea typeface="Family"/>
</p:sld>
`
}

function assertIdmlClassification(report: DocumentFontReport): void {
  assert.equal(report.kind, 'idml')
  assert.deepEqual(
    report.fonts.map((font) => ({
      postscriptName: font.postscriptName,
      familyName: font.familyName,
      styleName: font.styleName,
      status: font.status,
      assetId: font.assetId,
      installedFingerprint: font.installedFingerprint,
      matchedBy: font.matchedBy,
    })),
    [
      {
        postscriptName: 'Family-Bold',
        familyName: 'Family',
        styleName: 'Bold',
        status: 'on',
        assetId: 'bold',
        installedFingerprint: 'fp-bold',
        matchedBy: 'postscript',
      },
      {
        postscriptName: 'OtherCut-Regular',
        familyName: 'Family',
        styleName: 'Regular',
        status: 'on',
        assetId: 'regular',
        installedFingerprint: undefined,
        matchedBy: 'family-style',
      },
      {
        postscriptName: 'Nope-Regular',
        familyName: 'Nope',
        styleName: 'Regular',
        status: 'missing',
        assetId: undefined,
        installedFingerprint: undefined,
        matchedBy: undefined,
      },
    ],
  )
}

function idmlCatalog(): CatalogEntry[] {
  return [
    catalogEntry({
      id: 'bold',
      postscriptName: 'Family-Bold',
      familyName: 'Family',
      styleName: 'Bold',
      status: 'installed',
      installedFingerprint: 'fp-bold',
    }),
    catalogEntry({
      id: 'regular',
      postscriptName: 'Family-Regular',
      familyName: 'Family',
      styleName: 'Regular',
      status: 'installed',
      installedFingerprint: 'fp-should-not-pin',
    }),
  ]
}

function idmlFontsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Fonts xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <Font Self="d1" FontFamily="Family" Name="Family Bold" PostScriptName="Family-Bold" FontStyleName="Bold" />
  <Font Self="d2" FontFamily="Family" Name="Family" PostScriptName="OtherCut-Regular" FontStyleName="Regular" />
  <Font Self="d3" FontFamily="Nope" Name="Nope" PostScriptName="Nope-Regular" FontStyleName="Regular" />
</idPkg:Fonts>
`
}

function catalogEntry(options: {
  id: string
  postscriptName: string
  familyName: string
  styleName: string
  status: FontStatus
  installedFingerprint?: string
}): CatalogEntry {
  return {
    id: options.id,
    sourcePath: `/library/${options.postscriptName}.otf`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: options.status,
    installedFingerprint: options.installedFingerprint,
    faces: [
      {
        familyName: options.familyName,
        styleName: options.styleName,
        fullName: `${options.familyName} ${options.styleName}`,
        postscriptName: options.postscriptName,
        isVariable: false,
        instanceCount: 0,
        instanceNames: [],
        weight: 400,
        italic: false,
      },
    ],
    format: 'otf',
    addedAt: 1,
    updatedAt: 1,
  }
}

function indesignWithXmp(): Buffer {
  const packets = [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description>placed image</rdf:Description></x:xmpmeta>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><xmpTPg:Fonts><rdf:Bag><rdf:li stFnt:fontName="  "/></rdf:Bag></xmpTPg:Fonts></x:xmpmeta>',
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">
      <xmpTPg:Fonts>
        <rdf:Bag>
          <rdf:li stFnt:fontName="MinionPro-Regular" stFnt:fontFamily="Minion Pro" stFnt:fontFace="Regular"/>
          <rdf:li rdf:parseType="Resource">
            <stFnt:fontName>Family-Bold</stFnt:fontName>
            <stFnt:fontFamily>Family</stFnt:fontFamily>
            <stFnt:fontFace>Bold</stFnt:fontFace>
          </rdf:li>
          <rdf:li stFnt:fontName="Ampersand-Regular" stFnt:fontFamily="A &amp; B" stFnt:fontFace="Regular"/>
        </rdf:Bag>
      </xmpTPg:Fonts>
    </x:xmpmeta>`,
    '<x:xmpmeta><xmpTPg:Fonts><rdf:Bag><rdf:li stFnt:fontName="Ignored-Face" stFnt:fontFamily="Ignored" stFnt:fontFace="Regular"/></rdf:Bag></xmpTPg:Fonts></x:xmpmeta>',
  ]
  return Buffer.concat([Buffer.from('DOCUMENT\0', 'utf8'), ...packets.map((packet) => Buffer.from(packet, 'utf8'))])
}

function photoshopFile(engine: Buffer | string, version = 1): Buffer {
  const engineBytes = Buffer.isBuffer(engine) ? engine : Buffer.from(engine, 'latin1')
  const width = version === 2 ? 8 : 4
  const tysh = Buffer.concat([
    Buffer.from('8BIMTySh', 'ascii'),
    uInt(engineBytes.length, 4),
    engineBytes,
  ])
  const name = Buffer.from([0x01, 0x41, 0x00, 0x00])
  const extraBody = Buffer.concat([uInt(0, 4), uInt(0, 4), name, tysh])
  const layer = Buffer.concat([
    Buffer.alloc(16),
    uInt(0, 2),
    Buffer.alloc(12),
    uInt(extraBody.length, 4),
    extraBody,
  ])
  const layerInfoBody = Buffer.concat([uInt(1, 2), layer])
  const layerMaskBody = Buffer.concat([uInt(layerInfoBody.length, width), layerInfoBody])
  return Buffer.concat([
    Buffer.from('8BPS', 'ascii'),
    uInt(version, 2),
    Buffer.alloc(20),
    uInt(0, 4),
    uInt(0, 4),
    uInt(layerMaskBody.length, width),
    layerMaskBody,
  ])
}

function uInt(value: number, bytes: number): Buffer {
  const buffer = Buffer.alloc(bytes)
  for (let index = bytes - 1; index >= 0; index -= 1) {
    buffer[index] = value & 0xff
    value = Math.floor(value / 256)
  }
  return buffer
}

function pdfWithFlateBaseFont(name: string): Buffer {
  const inner = Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>`)
  const compressed = zlib.deflateSync(inner)
  const header = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
  )
  const footer = Buffer.from('\nendstream\nendobj\ntrailer\n<< >>\n%%EOF\n')
  return Buffer.concat([header, compressed, footer])
}

function zipPackage(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const stored = file.name === 'mimetype'
    const payload = stored ? file.data : zlib.deflateRawSync(file.data)
    const crc = zlib.crc32(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const chunk = Buffer.concat([local, name, payload])
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(stored ? 0 : 8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))
    locals.push(chunk)
    offset += chunk.length
  }
  const centralDir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDir, eocd])
}

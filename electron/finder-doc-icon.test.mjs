import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  CLAIMED_FONT_EXTENSIONS,
  FINDER_DOC_ICON,
  FINDER_DOC_ICON_FILE,
  FINDER_DOC_PNG_SIZES,
  FINDER_DOC_SVG,
  finderDocPngName,
  systemFontDocumentTypes,
  withFinderDocIcon,
} from './finder-doc-icon.mjs'

const DANIEL_FINDER_DOC_SVG = `<svg width="36" height="35" viewBox="0 0 36 35" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M5 35V0H23V9H32V35H5Z" fill="#D9D9D9"/>
<path d="M23 9V0L32 9H23Z" fill="#A9A9A9"/>
<path d="M10.2256 11L10.2256 31C15.7903 30.7047 20.2256 26.3259 20.2256 20.9721C20.2256 15.6184 15.7903 11.2953 10.2256 11Z" fill="black"/>
<path d="M17.2666 10.959C23.002 11.2549 27.5741 15.5865 27.5742 20.9512C27.5742 26.3159 23.002 30.7041 17.2666 31V30.2578C20.7525 28.3998 23.1054 24.9272 23.1055 20.9492C23.1055 16.9709 20.7528 13.5259 17.2666 11.6855V10.959Z" fill="black"/>
</svg>
`

function readRepo(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url))
}

function pngSize(buffer) {
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function icnsTypes(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'icns')
  assert.equal(buffer.readUInt32BE(4), buffer.length)
  const types = []
  let offset = 8
  while (offset < buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32BE(offset + 4)
    types.push(type)
    offset += length
  }
  return types
}

test('finder document SVG is Daniel’s 36×35 source art', () => {
  const svg = readRepo(FINDER_DOC_SVG).toString('utf8')
  assert.equal(svg, DANIEL_FINDER_DOC_SVG)
  assert.match(svg, /viewBox="0 0 36 35"/)
  assert.match(svg, /fill="#D9D9D9"/)
  assert.match(svg, /fill="#A9A9A9"/)
})

test('finder document PNG masters cover 16/32/128/256/512/1024', () => {
  for (const size of FINDER_DOC_PNG_SIZES) {
    const png = readRepo(`build/${finderDocPngName(size)}`)
    assert.deepEqual(pngSize(png), { width: size, height: size })
  }
})

test('finder document icns packs PNG masters for Finder', () => {
  const icns = readRepo(`build/${FINDER_DOC_ICON_FILE}`)
  const types = icnsTypes(icns)
  assert.equal(types[0], 'TOC ')
  assert.ok(types.includes('icp4'))
  assert.ok(types.includes('icp5'))
  assert.ok(types.includes('ic07'))
  assert.ok(types.includes('ic08'))
  assert.ok(types.includes('ic09'))
  assert.ok(types.includes('ic10'))
})

test('electron-builder document types use the finder doc icns for claimed font roles', () => {
  const pkg = JSON.parse(readRepo('package.json').toString('utf8'))
  const associations = pkg.build.fileAssociations
  assert.deepEqual(
    associations.map((item) => item.ext),
    CLAIMED_FONT_EXTENSIONS,
  )
  assert.deepEqual(withFinderDocIcon(associations), associations)
  assert.ok(associations.every((item) => item.icon === FINDER_DOC_ICON))
  assert.ok(associations.every((item) => item.role === 'Editor'))
  assert.deepEqual(pkg.build.mac.extendInfo.CFBundleDocumentTypes, systemFontDocumentTypes())
})

test('open/import still accept the claimed font extensions', () => {
  const main = readRepo('electron/main.mjs').toString('utf8')
  assert.match(main, /app\.on\('open-file'/)
  assert.match(main, /\\?\.\(ttf\|otf\|ttc\|otc\|woff2\?\)\$/)
  assert.match(main, /extensions: \['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2'\]/)
  assert.equal(main.includes('finderDocIcon'), false)
  assert.match(main, /menubarNotificationTemplate\.svg/)
  assert.match(main, /image\.setTemplateImage\(true\)/)
})

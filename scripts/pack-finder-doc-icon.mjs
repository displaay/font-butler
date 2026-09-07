import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FINDER_DOC_ICON_FILE,
  FINDER_DOC_PNG_SIZES,
  FINDER_DOC_SVG,
  finderDocPngName,
} from '../electron/finder-doc-icon.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = path.join(project, FINDER_DOC_SVG)
const buildDir = path.join(project, 'build')

const ICNS_TYPES = [
  { size: 16, type: 'icp4' },
  { size: 32, type: 'icp5' },
  { size: 32, type: 'ic11' },
  { size: 64, type: 'icp6' },
  { size: 64, type: 'ic12' },
  { size: 128, type: 'ic07' },
  { size: 256, type: 'ic08' },
  { size: 256, type: 'ic13' },
  { size: 512, type: 'ic09' },
  { size: 512, type: 'ic14' },
  { size: 1024, type: 'ic10' },
]

function requireRsvgConvert() {
  const result = spawnSync('rsvg-convert', ['--version'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error('rsvg-convert is required to rasterize finderDocIcon.svg')
  }
}

function squareSvg(source, size) {
  const inner = source.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return `<svg width="${size}" height="${size}" viewBox="0 0 36 35" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${inner}</svg>\n`
}

function rasterizePng(sourceSvg, size, outputPath) {
  const wrappedPath = `${outputPath}.svg`
  fs.writeFileSync(wrappedPath, squareSvg(sourceSvg, size))
  const result = spawnSync(
    'rsvg-convert',
    ['-w', String(size), '-h', String(size), '-f', 'png', '-o', outputPath, wrappedPath],
    { encoding: 'utf8' },
  )
  fs.rmSync(wrappedPath, { force: true })
  if (result.status !== 0) {
    throw new Error(result.stderr || `rsvg-convert failed for ${size}px`)
  }
}

function packIcns(pngBySize, outputPath) {
  const icons = ICNS_TYPES.map(({ size, type }) => {
    const data = pngBySize.get(size)
    if (!data) {
      throw new Error(`Missing ${size}px PNG for ICNS type ${type}`)
    }
    return { type, data }
  })
  const tocEntries = icons.map(({ type, data }) => ({ type, length: 8 + data.length }))
  const tocData = Buffer.alloc(8 * tocEntries.length)
  tocEntries.forEach((entry, index) => {
    tocData.write(entry.type, index * 8, 4, 'ascii')
    tocData.writeUInt32BE(entry.length, index * 8 + 4)
  })
  const chunks = [{ type: 'TOC ', data: tocData }, ...icons]
  const body = Buffer.concat(
    chunks.map(({ type, data }) => {
      const header = Buffer.alloc(8)
      header.write(type, 0, 4, 'ascii')
      header.writeUInt32BE(8 + data.length, 4)
      return Buffer.concat([header, data])
    }),
  )
  const file = Buffer.alloc(8)
  file.write('icns', 0, 4, 'ascii')
  file.writeUInt32BE(8 + body.length, 4)
  fs.writeFileSync(outputPath, Buffer.concat([file, body]))
}

requireRsvgConvert()
const sourceSvg = fs.readFileSync(svgPath, 'utf8')
const sizes = [...new Set([...FINDER_DOC_PNG_SIZES, 64])]
const pngBySize = new Map()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finder-doc-icon-'))
try {
  for (const size of sizes) {
    const tmpPng = path.join(tmp, finderDocPngName(size))
    rasterizePng(sourceSvg, size, tmpPng)
    const png = fs.readFileSync(tmpPng)
    if (FINDER_DOC_PNG_SIZES.includes(size)) {
      fs.writeFileSync(path.join(buildDir, finderDocPngName(size)), png)
    }
    pngBySize.set(size, png)
  }
  packIcns(pngBySize, path.join(buildDir, FINDER_DOC_ICON_FILE))
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(
  `Wrote ${FINDER_DOC_PNG_SIZES.map(finderDocPngName).join(', ')} and ${FINDER_DOC_ICON_FILE}`,
)

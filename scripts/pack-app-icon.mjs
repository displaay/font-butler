import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, macosDockIconPng } from '../electron/dock-icon.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(project, 'build/icons/cuttler/app.png')
const outputPath = path.join(project, 'build/icon.icns')

// macOS Big Sur icon grid rendered by macosDockIconPng: the 1024 canvas leaves
// a 100px transparent margin around an 824px rounded tile, matching what
// app.dock.setIcon shows while the app runs.
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

function downscale(src, size) {
  if (src.width === size && src.height === size) return src
  const { width, height, data } = src
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor((x * width) / size)
      const y0 = Math.floor((y * height) / size)
      const x1 = Math.max(x0, Math.floor(((x + 1) * width - 1) / size))
      const y1 = Math.max(y0, Math.floor(((y + 1) * height - 1) / size))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = y0; sy <= y1; sy += 1) {
        for (let sx = x0; sx <= x1; sx += 1) {
          const i = (sy * width + sx) * 4
          const alpha = data[i + 3] / 255
          r += data[i] * alpha
          g += data[i + 1] * alpha
          b += data[i + 2] * alpha
          a += alpha
          n += 1
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
        out[o + 3] = Math.round((a / n) * 255)
      }
    }
  }
  return { width: size, height: size, data: out }
}

function packIcns(pngBySize, outPath) {
  const icons = ICNS_TYPES.map(({ size, type }) => {
    const source = pngBySize.get(size)
    if (!source) throw new Error(`Missing ${size}px PNG for ICNS type ${type}`)
    return { type, data: encodePng(size, size, source.data) }
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
  fs.writeFileSync(outPath, Buffer.concat([file, body]))
}

const shaped1024 = decodePng(macosDockIconPng(fs.readFileSync(sourcePath)))
packIcns(
  new Map(ICNS_TYPES.map(({ size }) => [size, downscale(shaped1024, size)])),
  outputPath,
)
console.log(`Wrote ${path.relative(project, outputPath)} from ${path.relative(project, sourcePath)}`)

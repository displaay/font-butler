import zlib from 'node:zlib'

// macOS Big Sur app-icon grid: on a 1024 canvas the visible tile is an
// 824px rounded rectangle with a 185px corner radius (100px margin).
// Finder masks the bundle .icns to that shape. Electron's app.dock.setIcon
// does not, so a full-bleed bitmap paints a larger sharp square.
const MARGIN_RATIO = 100 / 1024
const RADIUS_RATIO = 185 / 824

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

export function decodePng(png) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Dock icon is not a PNG')
  }
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error('Dock icon PNG must be 8-bit RGB or RGBA')
  }
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const inflated = zlib.inflateSync(Buffer.concat(idat))
  const rgba = Buffer.alloc(width * height * 4)
  let i = 0
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[i]
    i += 1
    const row = Buffer.from(inflated.subarray(i, i + stride))
    i += stride
    const out = Buffer.alloc(stride)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[x - channels] : 0
      const up = prev[x]
      const ul = x >= channels ? prev[x - channels] : 0
      let value = row[x]
      if (filter === 1) value = (value + left) & 255
      else if (filter === 2) value = (value + up) & 255
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) {
        const p = left + up - ul
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - ul)
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul
        value = (value + pr) & 255
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}`)
      }
      out[x] = value
    }
    const dest = y * width * 4
    if (channels === 4) {
      out.copy(rgba, dest)
    } else {
      for (let x = 0; x < width; x += 1) {
        const s = x * 3
        const d = dest + x * 4
        rgba[d] = out[s]
        rgba[d + 1] = out[s + 1]
        rgba[d + 2] = out[s + 2]
        rgba[d + 3] = 255
      }
    }
    prev = out
  }
  return { width, height, data: rgba }
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1)
    raw[start] = 0
    rgba.copy(raw, start + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function sdRoundedBox(px, py, half, radius) {
  const qx = Math.abs(px) - half + radius
  const qy = Math.abs(py) - half + radius
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

function coverage(x, y, size, box, radius) {
  const sd = sdRoundedBox(x + 0.5 - size / 2, y + 0.5 - size / 2, box / 2, radius)
  if (sd >= 0.5) return 0
  if (sd <= -0.5) return 1
  return 0.5 - sd
}

function opaqueBounds(src) {
  const { width, height, data } = src
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { minX, minY, maxX, maxY }
}

function sample(src, fx, fy) {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return [0, 0, 0, 0]
    const i = (y * src.width + x) * 4
    const a = src.data[i + 3] / 255
    return [src.data[i] * a, src.data[i + 1] * a, src.data[i + 2] * a, a]
  }
  const mix = (a, b) => [
    a[0] + (b[0] - a[0]) * tx,
    a[1] + (b[1] - a[1]) * tx,
    a[2] + (b[2] - a[2]) * tx,
    a[3] + (b[3] - a[3]) * tx,
  ]
  const top = mix(at(x0, y0), at(x0 + 1, y0))
  const bottom = mix(at(x0, y0 + 1), at(x0 + 1, y0 + 1))
  const blended = [
    top[0] + (bottom[0] - top[0]) * ty,
    top[1] + (bottom[1] - top[1]) * ty,
    top[2] + (bottom[2] - top[2]) * ty,
    top[3] + (bottom[3] - top[3]) * ty,
  ]
  if (blended[3] <= 0.001) return [0, 0, 0, 0]
  return [
    blended[0] / blended[3],
    blended[1] / blended[3],
    blended[2] / blended[3],
    blended[3] * 255,
  ]
}

export function macosDockIconPng(png) {
  const src = decodePng(png)
  const size = Math.max(src.width, src.height)
  const box = size * (1 - 2 * MARGIN_RATIO)
  const radius = box * RADIUS_RATIO
  const rgba = Buffer.alloc(size * size * 4)
  const bounds = opaqueBounds(src)
  if (!bounds) return encodePng(size, size, rgba)

  const bw = bounds.maxX - bounds.minX + 1
  const bh = bounds.maxY - bounds.minY + 1
  const scale = box / Math.max(bw, bh)
  const dw = bw * scale
  const dh = bh * scale
  const left = (size - dw) / 2
  const top = (size - dh) / 2

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cover = coverage(x, y, size, box, radius)
      if (cover <= 0) continue
      const u = (x + 0.5 - left) / dw
      const v = (y + 0.5 - top) / dh
      if (u < 0 || v < 0 || u > 1 || v > 1) continue
      const [r, g, b, a] = sample(src, bounds.minX + u * bw - 0.5, bounds.minY + v * bh - 0.5)
      const alpha = a * cover
      if (alpha < 0.5) continue
      const o = (y * size + x) * 4
      rgba[o] = Math.round(r)
      rgba[o + 1] = Math.round(g)
      rgba[o + 2] = Math.round(b)
      rgba[o + 3] = Math.round(alpha)
    }
  }
  return encodePng(size, size, rgba)
}

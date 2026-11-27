import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { decodePng, macosDockIconPng } from './dock-icon.mjs'

function alpha(image, x, y) {
  return image.data[(y * image.width + x) * 4 + 3]
}

function pixel(image, x, y) {
  const i = (y * image.width + x) * 4
  return image.data.subarray(i, i + 4)
}

function shaped(relativePath) {
  const png = readFileSync(new URL(`../${relativePath}`, import.meta.url))
  return decodePng(macosDockIconPng(png))
}

test('dock icons use the macOS rounded tile instead of a full-bleed square', () => {
  for (const file of [
    'build/icon.png',
    'build/icons/bright/app.png',
    'build/icons/mono/app.png',
    'build/icons/cuttler/app.png',
  ]) {
    const icon = shaped(file)
    assert.equal(icon.width, 1024)
    assert.equal(icon.height, 1024)
    assert.equal(alpha(icon, 0, 0), 0, `${file} canvas corner`)
    assert.equal(alpha(icon, 1023, 1023), 0, `${file} canvas corner`)
    assert.equal(alpha(icon, 512, 40), 0, `${file} top margin`)
    assert.equal(alpha(icon, 40, 512), 0, `${file} side margin`)
    assert.equal(alpha(icon, 100, 100), 0, `${file} rounded corner`)
    assert.equal(alpha(icon, 150, 150), 0, `${file} outside corner arc`)
    assert.ok(alpha(icon, 512, 140) > 200, `${file} top edge of the tile`)
    assert.ok(alpha(icon, 180, 180) > 200, `${file} inside corner arc`)
    assert.ok(alpha(icon, 512, 512) > 200, `${file} center`)
  }
})

test('classic dock icon keeps the yellow and black artwork inside the tile', () => {
  const source = decodePng(readFileSync(new URL('../build/icon.png', import.meta.url)))
  const icon = shaped('build/icon.png')
  const yellow = pixel(icon, 200, 512)
  assert.ok(yellow[0] > 200 && yellow[1] > 200 && yellow[2] < 40, yellow.join(','))
  const dark = pixel(icon, 512, 400)
  assert.ok(dark[0] < 40 && dark[1] < 40 && dark[2] < 40, dark.join(','))
  assert.equal(source.data[3], 255)
  assert.equal(alpha(icon, 0, 0), 0)
})

test('cuttler dock icon keeps the yellow field and black mark inside the tile', () => {
  const source = decodePng(readFileSync(new URL('../build/icons/cuttler/app.png', import.meta.url)))
  const icon = shaped('build/icons/cuttler/app.png')
  assert.equal(source.width, 1024)
  assert.equal(source.height, 1024)
  assert.deepEqual([...source.data.subarray(0, 4)], [255, 254, 0, 255])
  const yellow = pixel(icon, 512, 140)
  assert.ok(yellow[0] > 200 && yellow[1] > 200 && yellow[2] < 40, yellow.join(','))
  const dark = pixel(icon, 512, 512)
  assert.ok(dark[0] < 40 && dark[1] < 40 && dark[2] < 40, dark.join(','))
  assert.equal(alpha(icon, 0, 0), 0)
})

function icnsPng(icns, type) {
  let offset = 8
  while (offset + 8 <= icns.length) {
    const chunkType = icns.toString('ascii', offset, offset + 4)
    const length = icns.readUInt32BE(offset + 4)
    if (chunkType === type) return icns.subarray(offset + 8, offset + length)
    offset += length
  }
  throw new Error(`icns chunk ${type} not found`)
}

function pngChunks(icns) {
  assert.equal(icns.toString('ascii', 0, 4), 'icns', 'icns magic')
  const total = icns.readUInt32BE(4)
  assert.equal(total, icns.length, 'icns length matches file size')
  const chunks = []
  let offset = 8
  while (offset + 8 <= icns.length) {
    const type = icns.toString('ascii', offset, offset + 4)
    const length = icns.readUInt32BE(offset + 4)
    assert.ok(length >= 8 && offset + length <= icns.length, `chunk ${type} fits in the file`)
    const data = icns.subarray(offset + 8, offset + length)
    if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
      chunks.push({ type, width: data.readUInt32BE(16), height: data.readUInt32BE(20) })
    } else {
      chunks.push({ type })
    }
    offset += length
  }
  assert.equal(offset, icns.length, 'icns chunks cover the file')
  return chunks
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

test('packaged mac bundle icon shows the cuttler mark behind the running dock icon', () => {
  const icns = readFileSync(new URL('../build/icon.icns', import.meta.url))
  const chunks = pngChunks(icns)
  const byType = new Map(chunks.map((chunk) => [chunk.type, chunk]))
  for (const [type, size] of [
    ['icp4', 16],
    ['icp5', 32],
    ['ic11', 32],
    ['icp6', 64],
    ['ic12', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic13', 256],
    ['ic09', 512],
    ['ic14', 512],
    ['ic10', 1024],
  ]) {
    const chunk = byType.get(type)
    assert.ok(chunk, `${type} chunk present`)
    assert.equal(chunk.width, size, `${type} width`)
    assert.equal(chunk.height, size, `${type} height`)
  }
  // The tile is shaped like macosDockIconPng so quitting the app does not
  // jump between the shaped runtime dock icon and a full-bleed bundle icon.
  const bundle = decodePng(icnsPng(icns, 'ic10'))
  assert.equal(bundle.width, 1024)
  assert.equal(bundle.height, 1024)
  assert.equal(alpha(bundle, 0, 0), 0, 'bundle icon canvas corner')
  assert.equal(alpha(bundle, 512, 40), 0, 'bundle icon top margin')
  assert.equal(alpha(bundle, 100, 100), 0, 'bundle icon rounded corner')
  assert.ok(alpha(bundle, 512, 140) > 200, 'bundle icon tile top edge')
  assert.deepEqual([...pixel(bundle, 512, 140)], [255, 254, 0, 255], 'bundle icon yellow field')
  assert.ok(pixel(bundle, 512, 512)[0] < 40, 'bundle icon dark cuttler mark')
})

test('bundle .icns does not fall back to the classic Butt palette', () => {
  const icns = readFileSync(new URL('../build/icon.icns', import.meta.url))
  const classic = shaped('build/icon.png')
  // The classic icon is opaque black artwork at the tile top edge; cuttler is
  // solid yellow there, so this distinguishes the two marks.
  const classicTop = pixel(classic, 512, 140)
  assert.ok(classicTop[0] < 40 && classicTop[2] < 40, 'classic icon is dark at tile top')
  let offset = 8
  let checked = 0
  while (offset + 8 <= icns.length) {
    const data = icns.subarray(offset + 8, offset + icns.readUInt32BE(offset + 4))
    if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
      const image = decodePng(data)
      const top = pixel(image, image.width / 2, Math.round(image.height * 140 / 1024))
      assert.ok(top[0] > 200 && top[1] > 200 && top[2] < 40, `chunk is yellow at tile top`)
      checked += 1
    }
    offset += icns.readUInt32BE(offset + 4)
  }
  assert.ok(checked >= 11, `checked ${checked} png chunks`)
})

test('cuttler menu bar icons are 22px and 44px black templates', () => {
  for (const [file, size] of [
    ['build/icons/cuttler/tray.png', 22],
    ['build/icons/cuttler/tray@2x.png', 44],
    ['build/icons/cuttler/tray-attention.png', 22],
    ['build/icons/cuttler/tray-attention@2x.png', 44],
  ]) {
    const icon = decodePng(readFileSync(new URL(`../${file}`, import.meta.url)))
    assert.equal(icon.width, size, file)
    assert.equal(icon.height, size, file)
    assert.equal(alpha(icon, 0, 0), 0, file)
    let opaque = 0
    for (let i = 0; i < icon.data.length; i += 4) {
      if (icon.data[i + 3] <= 16) continue
      opaque += 1
      assert.equal(icon.data[i], 0, file)
      assert.equal(icon.data[i + 1], 0, file)
      assert.equal(icon.data[i + 2], 0, file)
    }
    assert.ok(opaque > 20, file)
  }
})

test('cuttler tray-attention adds a dot in the top-right without overlapping the mark', () => {
  const quiet = decodePng(readFileSync(new URL('../build/icons/cuttler/tray.png', import.meta.url)))
  const attention = decodePng(
    readFileSync(new URL('../build/icons/cuttler/tray-attention.png', import.meta.url)),
  )
  assert.equal(attention.width, quiet.width)
  assert.equal(attention.height, quiet.height)
  const at = (image, x, y) => image.data[(y * image.width + x) * 4 + 3]
  // Quiet is empty in the top strip; only the dot paints there.
  let dotPixels = 0
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < quiet.width; x += 1) {
      if (at(attention, x, y) > 16) {
        assert.equal(at(quiet, x, y) <= 16, true, `quiet is also opaque at ${x},${y}`)
        assert.ok(x >= quiet.width / 2, `dot pixel ${x},${y} is not in the right half`)
        dotPixels += 1
      }
    }
  }
  assert.ok(dotPixels > 5, `expected a visible dot in the top strip, got ${dotPixels} pixels`)
  // The dot sits in the top-right corner and leaves a gap above the mark.
  assert.ok(at(attention, quiet.width - 1, 0) <= 16, 'dot clips the right edge')
  assert.equal(at(attention, 4, 21), 0, 'dot or mark clips the bottom edge')
})

test('packaged app ships the cuttler attention tray icon', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.build.files.includes('build/icons/**/*'))
  const updatesMenu = readFileSync(new URL('./updates-menu.mjs', import.meta.url), 'utf8')
  assert.match(updatesMenu, /tray-attention\.png/)
})

test('startup does not paint the dock icon before the saved appIcon setting loads', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  // The gate must exist and default to "not yet loaded" so early applyDockIcon
  // calls (app.whenReady / showDockIcon) leave the bundle's icon.icns in place.
  assert.match(main, /let appIconStyleLoaded = false/)
  // applyDockIcon itself must refuse to paint while the setting is unloaded.
  const fn = main.match(/function applyDockIcon\(\) \{[\s\S]*?\n\}/)
  assert.ok(fn, 'applyDockIcon function found')
  assert.match(fn[0], /if \(!appIconStyleLoaded\) \{\s*\n\s*return/)
  // Only loading the saved setting clears the gate; it must do so before painting.
  const setter = main.match(/function applyAppIconSetting\(style\) \{[\s\S]*?\n\}/)
  assert.ok(setter, 'applyAppIconSetting function found')
  assert.ok(
    setter[0].indexOf('appIconStyleLoaded = true') < setter[0].indexOf('applyDockIcon()'),
    'applyAppIconSetting sets appIconStyleLoaded before painting the dock icon',
  )
})

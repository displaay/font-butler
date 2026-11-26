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

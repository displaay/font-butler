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

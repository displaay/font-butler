import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { allowedFontPath, ensureSystemFontScan, isHiddenSystemFamily, scanSystemFonts } from './system.ts'
import { tempPaths, writeTestCollection, writeTestFont } from './test-util.ts'

test('isHiddenSystemFamily matches Apple’s period-prefixed UI families', () => {
  assert.equal(isHiddenSystemFamily('.Apple Color Emoji UI'), true)
  assert.equal(isHiddenSystemFamily('.LastResort'), true)
  assert.equal(isHiddenSystemFamily('Apple Color Emoji'), false)
  assert.equal(isHiddenSystemFamily('Arial'), false)
})

test('scanSystemFonts omits dotted UI faces from a TTC that also has a public family', () => {
  const paths = tempPaths()
  try {
    writeTestCollection(path.join(paths.systemFontsDir, 'Emoji.ttc'), [
      { family: 'Apple Color Emoji', psName: 'AppleColorEmoji' },
      { family: '.Apple Color Emoji UI', psName: '.AppleColorEmojiUI' },
    ])
    const faces = scanSystemFonts(paths)
    assert.deepEqual(
      faces.map((face) => face.familyName),
      ['Apple Color Emoji'],
    )
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('scanSystemFonts skips hidden font files', () => {
  const paths = tempPaths()
  try {
    writeTestFont(path.join(paths.systemFontsDir, '.Hidden.ttf'), 'HiddenFace', 'Hidden-Regular')
    writeTestFont(path.join(paths.systemFontsDir, 'Public.ttf'), 'PublicFace', 'Public-Regular')
    const faces = scanSystemFonts(paths)
    assert.equal(faces.some((face) => face.familyName === 'HiddenFace'), false)
    assert.equal(faces.some((face) => face.familyName === 'PublicFace'), true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('ensureSystemFontScan finishes remaining uncached faces', async () => {
  const paths = tempPaths()
  try {
    writeTestFont(path.join(paths.systemFontsDir, 'Public.ttf'), 'PublicFace', 'Public-Regular')
    const faces = await ensureSystemFontScan(paths)
    assert.equal(faces.some((face) => face.familyName === 'PublicFace'), true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('allowedFontPath accepts an Adobe-only adopted path', () => {
  const paths = tempPaths()
  try {
    const font = path.join(paths.adobeFontsDir, 'AdobeOnly.ttf')
    fs.mkdirSync(paths.adobeFontsDir, { recursive: true })
    fs.writeFileSync(font, 'font')
    assert.equal(allowedFontPath(font, paths), true)
    const outside = path.join(paths.dataRoot, 'elsewhere', 'Outside.ttf')
    fs.mkdirSync(path.dirname(outside), { recursive: true })
    fs.writeFileSync(outside, 'font')
    assert.equal(allowedFontPath(outside, paths), false)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

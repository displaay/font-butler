import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  allowRealCacheMutation,
  applyAdobeFontCacheClear,
  locateAdobeFontCache,
  locateOfficeFontCache,
} from './caches.ts'

test('locateOfficeFontCache finds the standard Office Group Container cache', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-office-'))
  const cache = path.join(home, 'Library/Group Containers/UBF8T346G9.Office/FontCache')
  try {
    fs.mkdirSync(cache, { recursive: true })
    const found = locateOfficeFontCache(home)
    assert.equal(found.exists, true)
    assert.equal(found.path, cache)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('locateOfficeFontCache finds another Office container when the known path is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-office-alt-'))
  const cache = path.join(home, 'Library/Group Containers/TEAMID.Office/FontCache')
  try {
    fs.mkdirSync(cache, { recursive: true })
    const found = locateOfficeFontCache(home)
    assert.equal(found.exists, true)
    assert.equal(found.path, cache)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('locateOfficeFontCache reports the known path when nothing exists', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-office-missing-'))
  try {
    const found = locateOfficeFontCache(home)
    assert.equal(found.exists, false)
    assert.equal(
      found.path,
      path.join(home, 'Library/Group Containers/UBF8T346G9.Office/FontCache'),
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('locateAdobeFontCache finds font list files and InDesign cache dirs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-adobe-'))
  const typeSupport = path.join(home, 'Library/Caches/Adobe/TypeSupport')
  const indesign = path.join(home, 'Library/Caches/Adobe InDesign/Version 19.0/InDesign Font Cache')
  const illustratorLst = path.join(
    home,
    'Library/Application Support/Adobe/Adobe Illustrator 2024/en_US/IllustratorFnt24.lst',
  )
  try {
    fs.mkdirSync(typeSupport, { recursive: true })
    fs.mkdirSync(indesign, { recursive: true })
    fs.mkdirSync(path.dirname(illustratorLst), { recursive: true })
    fs.writeFileSync(path.join(typeSupport, 'AdobeFnt15.lst'), 'cache')
    fs.writeFileSync(path.join(indesign, 'peek'), 'id')
    fs.writeFileSync(illustratorLst, 'ai')
    const found = locateAdobeFontCache(home)
    assert.equal(found.exists, true)
    assert.ok(found.paths.includes(typeSupport))
    assert.ok(found.paths.includes(indesign))
    assert.ok(found.paths.includes(illustratorLst))
    assert.deepEqual(found.roots, [
      path.join(home, 'Library/Caches/Adobe'),
      path.join(home, 'Library/Caches/Adobe InDesign'),
      path.join(home, 'Library/Application Support/Adobe/TypeSupport'),
    ])
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('locateAdobeFontCache ignores Creative Cloud, media, and Camera Raw caches', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-adobe-skip-'))
  const coresync = path.join(home, 'Library/Application Support/Adobe/CoreSync/plugins/livetype/r')
  const media = path.join(home, 'Library/Caches/Adobe/Common/Media Cache Files')
  const cameraRaw = path.join(home, 'Library/Caches/Adobe/Camera Raw/Cache')
  try {
    fs.mkdirSync(coresync, { recursive: true })
    fs.mkdirSync(media, { recursive: true })
    fs.mkdirSync(cameraRaw, { recursive: true })
    fs.writeFileSync(path.join(coresync, 'font.bin'), 'font')
    fs.writeFileSync(path.join(media, 'clip'), 'video')
    fs.writeFileSync(path.join(cameraRaw, 'preview'), 'raw')
    const found = locateAdobeFontCache(home)
    assert.equal(found.exists, false)
    assert.deepEqual(found.paths, [])
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('locateAdobeFontCache reports the known roots when nothing exists', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-adobe-missing-'))
  try {
    const found = locateAdobeFontCache(home)
    assert.equal(found.exists, false)
    assert.deepEqual(found.paths, [])
    assert.equal(found.roots[0], path.join(home, 'Library/Caches/Adobe'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('isolated FONT_BUTLER_DATA skips real cache mutation unless explicitly opted in', () => {
  const previousData = process.env.FONT_BUTLER_DATA
  const previousCaches = process.env.FONT_BUTLER_NATIVE_CACHES
  try {
    process.env.FONT_BUTLER_DATA = '/tmp/font-butler-isolated'
    delete process.env.FONT_BUTLER_NATIVE_CACHES
    assert.equal(allowRealCacheMutation(), false)
    process.env.FONT_BUTLER_NATIVE_CACHES = '1'
    assert.equal(allowRealCacheMutation(), true)
  } finally {
    if (previousData === undefined) delete process.env.FONT_BUTLER_DATA
    else process.env.FONT_BUTLER_DATA = previousData
    if (previousCaches === undefined) delete process.env.FONT_BUTLER_NATIVE_CACHES
    else process.env.FONT_BUTLER_NATIVE_CACHES = previousCaches
  }
})

test('applyAdobeFontCacheClear removes font caches and leaves other Adobe data', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-adobe-clear-'))
  const typeSupport = path.join(home, 'Library/Caches/Adobe/TypeSupport')
  const lst = path.join(typeSupport, 'AdobeFnt15.lst')
  const cameraRaw = path.join(home, 'Library/Caches/Adobe/Camera Raw/Cache/preview')
  const coresync = path.join(home, 'Library/Application Support/Adobe/CoreSync/keep.bin')
  try {
    fs.mkdirSync(typeSupport, { recursive: true })
    fs.mkdirSync(path.dirname(cameraRaw), { recursive: true })
    fs.mkdirSync(path.dirname(coresync), { recursive: true })
    fs.writeFileSync(lst, 'cache')
    fs.writeFileSync(cameraRaw, 'raw')
    fs.writeFileSync(coresync, 'sync')
    assert.equal(applyAdobeFontCacheClear(home), true)
    assert.equal(fs.existsSync(lst), false)
    assert.equal(fs.existsSync(typeSupport), true)
    assert.equal(fs.existsSync(cameraRaw), true)
    assert.equal(fs.existsSync(coresync), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

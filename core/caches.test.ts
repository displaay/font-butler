import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { locateOfficeFontCache } from './caches.ts'

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

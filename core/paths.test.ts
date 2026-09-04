import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  APP_FOLDER_NAME,
  LEGACY_APP_FOLDER_NAME,
  migrateLegacyMacAppDirs,
} from './paths.ts'

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-paths-'))
}

test('migrateLegacyMacAppDirs moves the old app support and fonts folders', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', LEGACY_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', LEGACY_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(
      path.join(legacyData, 'catalog.json'),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: '1',
            sourcePath: '/Users/you/Fonts/Family.otf',
            installedPath: path.join(legacyInstall, 'Family.otf'),
            disabledPath: path.join(legacyData, 'Disabled', 'Family.otf'),
          },
        ],
      }),
    )
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')

    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.dataRoot, path.join(home, 'Library/Application Support', APP_FOLDER_NAME))
    assert.equal(next.installDir, path.join(home, 'Library/Fonts', APP_FOLDER_NAME))
    assert.equal(fs.existsSync(legacyData), false)
    assert.equal(fs.existsSync(legacyInstall), false)
    assert.equal(fs.existsSync(path.join(next.dataRoot, 'catalog.json')), true)
    assert.equal(fs.existsSync(path.join(next.installDir, 'Family.otf')), true)

    const catalog = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8'))
    assert.equal(catalog.entries[0].installedPath, path.join(next.installDir, 'Family.otf'))
    assert.equal(catalog.entries[0].disabledPath, path.join(next.dataRoot, 'Disabled', 'Family.otf'))
    assert.equal(catalog.entries[0].sourcePath, '/Users/you/Fonts/Family.otf')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('migrateLegacyMacAppDirs replaces a fresh empty destination created by a first launch', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', LEGACY_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(path.join(legacyData, 'sources'), { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), '{"version":1,"entries":[]}')
    fs.mkdirSync(path.join(nextData, 'uploads'), { recursive: true })

    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.dataRoot, nextData)
    assert.equal(fs.existsSync(legacyData), false)
    assert.equal(fs.existsSync(path.join(nextData, 'catalog.json')), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('migrateLegacyMacAppDirs keeps an already-migrated destination', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', LEGACY_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(nextData, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), '{"version":1,"entries":[{"id":"old"}]}')
    fs.writeFileSync(path.join(nextData, 'catalog.json'), '{"version":1,"entries":[{"id":"new"}]}')

    migrateLegacyMacAppDirs(home)
    const catalog = JSON.parse(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8'))
    assert.equal(catalog.entries[0].id, 'new')
    assert.equal(fs.existsSync(legacyData), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

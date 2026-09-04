import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { loadSettings, readWatchFolders, saveSettings } from './settings.ts'
import type { AppPaths } from './paths.ts'
import type { AppSettings } from './types.ts'

function tempPaths(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-settings-'))
  return {
    dataRoot,
    catalogPath: path.join(dataRoot, 'catalog.json'),
    settingsPath: path.join(dataRoot, 'settings.json'),
    apiTokenPath: path.join(dataRoot, 'token'),
    installDir: path.join(dataRoot, 'install'),
    disabledDir: path.join(dataRoot, 'disabled'),
    sourcesDir: path.join(dataRoot, 'sources'),
    uploadsDir: path.join(dataRoot, 'uploads'),
    systemCachePath: path.join(dataRoot, 'system.json'),
    seedDir: path.join(dataRoot, 'seed'),
    userFontsDir: path.join(dataRoot, 'user-fonts'),
    computerFontsDir: path.join(dataRoot, 'computer-fonts'),
    systemFontsDir: path.join(dataRoot, 'system-fonts'),
    supplementalFontsDir: path.join(dataRoot, 'supplemental'),
    officeFontCacheDir: path.join(dataRoot, 'office-cache'),
    atsCacheDir: path.join(dataRoot, 'ats-cache'),
  }
}

function sampleSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    version: 1,
    watchFolders: [],
    defaultView: 'list',
    defaultSort: 'name',
    installAfterUpload: true,
    theme: 'system',
    menuBarIcon: true,
    openAtLogin: false,
    clearOfficeFontCache: true,
    ...overrides,
  }
}

test('loadSettings defaults installAfterUpload to true', () => {
  const paths = tempPaths()
  try {
    assert.equal(loadSettings(paths).installAfterUpload, true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings keeps a stored installAfterUpload false', () => {
  const paths = tempPaths()
  try {
    saveSettings(paths, sampleSettings({ installAfterUpload: false }))
    assert.equal(loadSettings(paths).installAfterUpload, false)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings fills installAfterUpload on older settings files', () => {
  const paths = tempPaths()
  try {
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(
      paths.settingsPath,
      JSON.stringify({
        version: 1,
        watchFolder: null,
        defaultView: 'grid',
        defaultSort: 'installed',
      }),
    )
    const settings = loadSettings(paths)
    assert.equal(settings.installAfterUpload, true)
    assert.equal(settings.defaultView, 'grid')
    assert.equal(settings.theme, 'system')
    assert.equal(settings.menuBarIcon, true)
    assert.equal(settings.openAtLogin, false)
    assert.equal(settings.clearOfficeFontCache, true)
    assert.deepEqual(settings.watchFolders, [])
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings defaults theme to system', () => {
  const paths = tempPaths()
  try {
    assert.equal(loadSettings(paths).theme, 'system')
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings keeps a stored theme dark', () => {
  const paths = tempPaths()
  try {
    saveSettings(paths, sampleSettings({ theme: 'dark' }))
    assert.equal(loadSettings(paths).theme, 'dark')
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings fills theme on older settings files', () => {
  const paths = tempPaths()
  try {
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(
      paths.settingsPath,
      JSON.stringify({
        version: 1,
        watchFolder: null,
        defaultView: 'list',
        defaultSort: 'name',
        installAfterUpload: true,
      }),
    )
    assert.equal(loadSettings(paths).theme, 'system')
    assert.equal(loadSettings(paths).menuBarIcon, true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings defaults menuBarIcon to true', () => {
  const paths = tempPaths()
  try {
    assert.equal(loadSettings(paths).menuBarIcon, true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings keeps a stored menuBarIcon false', () => {
  const paths = tempPaths()
  try {
    saveSettings(paths, sampleSettings({ menuBarIcon: false }))
    assert.equal(loadSettings(paths).menuBarIcon, false)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings fills menuBarIcon on older settings files', () => {
  const paths = tempPaths()
  try {
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(
      paths.settingsPath,
      JSON.stringify({
        version: 1,
        watchFolder: null,
        defaultView: 'list',
        defaultSort: 'name',
        installAfterUpload: true,
        theme: 'system',
      }),
    )
    assert.equal(loadSettings(paths).menuBarIcon, true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings migrates a single watchFolder to watchFolders', () => {
  const paths = tempPaths()
  try {
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(
      paths.settingsPath,
      JSON.stringify({
        version: 1,
        watchFolder: '/Users/you/Fonts/Inbox',
        defaultView: 'list',
        defaultSort: 'name',
      }),
    )
    assert.deepEqual(loadSettings(paths).watchFolders, ['/Users/you/Fonts/Inbox'])
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings prefers watchFolders over a leftover watchFolder', () => {
  const paths = tempPaths()
  try {
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(
      paths.settingsPath,
      JSON.stringify({
        version: 1,
        watchFolder: '/old',
        watchFolders: ['/one', '/two', '/one'],
      }),
    )
    assert.deepEqual(loadSettings(paths).watchFolders, ['/one', '/two'])
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings defaults openAtLogin to false', () => {
  const paths = tempPaths()
  try {
    assert.equal(loadSettings(paths).openAtLogin, false)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings keeps a stored openAtLogin true', () => {
  const paths = tempPaths()
  try {
    saveSettings(paths, sampleSettings({ openAtLogin: true }))
    assert.equal(loadSettings(paths).openAtLogin, true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings defaults clearOfficeFontCache to true', () => {
  const paths = tempPaths()
  try {
    assert.equal(loadSettings(paths).clearOfficeFontCache, true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('loadSettings keeps a stored clearOfficeFontCache false', () => {
  const paths = tempPaths()
  try {
    saveSettings(paths, sampleSettings({ clearOfficeFontCache: false }))
    assert.equal(loadSettings(paths).clearOfficeFontCache, false)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('readWatchFolders ignores blanks and dedupes', () => {
  assert.deepEqual(readWatchFolders({ watchFolders: [' /a ', '', '/a', '/b'] }), ['/a', '/b'])
  assert.deepEqual(readWatchFolders({ watchFolder: '  /legacy  ' }), ['/legacy'])
  assert.deepEqual(readWatchFolders({}), [])
})

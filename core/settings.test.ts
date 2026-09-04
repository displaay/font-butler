import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { loadSettings, saveSettings } from './settings.ts'
import type { AppPaths } from './paths.ts'

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
    saveSettings(paths, {
      version: 1,
      watchFolder: null,
      defaultView: 'list',
      defaultSort: 'name',
      installAfterUpload: false,
    })
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
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

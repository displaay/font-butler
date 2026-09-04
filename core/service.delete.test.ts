import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { saveCatalog } from './catalog.ts'
import type { AppPaths } from './paths.ts'
import { FontButlerService } from './service.ts'
import type { CatalogEntry } from './types.ts'

function tempPaths(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-delete-'))
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

function uninstalledEntry(sourcePath: string): CatalogEntry {
  return {
    id: 'entry-1',
    sourcePath,
    sourceMtimeMs: Date.now(),
    sourceSize: 4,
    status: 'uninstalled',
    faces: [],
    format: 'otf',
    addedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

test('forget deleteFiles refuses a symlink to a protected system font', async () => {
  const paths = tempPaths()
  fs.mkdirSync(paths.systemFontsDir, { recursive: true })
  const protectedFile = path.join(paths.systemFontsDir, 'Protected.otf')
  const link = path.join(paths.dataRoot, 'Evil.otf')
  fs.writeFileSync(protectedFile, 'font')
  fs.symlinkSync(protectedFile, link)
  saveCatalog(paths, { version: 1, entries: [uninstalledEntry(link)] })
  const service = new FontButlerService(paths)
  try {
    await assert.rejects(
      () => service.forget('entry-1', { deleteFiles: true }),
      /System font files cannot be deleted/,
    )
    assert.equal(fs.existsSync(protectedFile), true)
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('uninstallSystem refuses a user-font symlink to a protected system font', async () => {
  const paths = tempPaths()
  fs.mkdirSync(paths.systemFontsDir, { recursive: true })
  fs.mkdirSync(paths.userFontsDir, { recursive: true })
  const protectedFile = path.join(paths.systemFontsDir, 'Protected.otf')
  const link = path.join(paths.userFontsDir, 'Trap.otf')
  fs.writeFileSync(protectedFile, 'font')
  fs.symlinkSync(protectedFile, link)
  const service = new FontButlerService(paths)
  try {
    await assert.rejects(
      () => service.uninstallSystem(link),
      /Protected system fonts cannot be removed/,
    )
    assert.equal(fs.existsSync(protectedFile), true)
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { FontButlerService } from './service.ts'
import { closeAllWatchers } from './watch.ts'
import type { AppPaths } from './paths.ts'

function tempPaths(): AppPaths {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-import-'))
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
    adobeFontsDir: path.join(dataRoot, 'adobe-fonts'),
  }
}

test('importPaths installs catalog entries from a nested folder', async (t) => {
  const sourceDir =
    '/Users/danielquisek/git/ms-office-safe-export/artifacts/test-fonts/Booton/Desktop package (OTF, TTF)/OTF'
  if (!fs.existsSync(sourceDir)) {
    t.skip('Booton test fonts are not on this machine')
    return
  }
  const otf = fs.readdirSync(sourceDir).find((name) => name.toLowerCase().endsWith('.otf'))
  assert.ok(otf)
  const paths = tempPaths()
  const dropRoot = path.join(paths.dataRoot, 'drop', 'Family', 'OTF')
  fs.mkdirSync(dropRoot, { recursive: true })
  fs.copyFileSync(path.join(sourceDir, otf), path.join(dropRoot, otf))
  fs.writeFileSync(path.join(paths.dataRoot, 'drop', 'readme.txt'), 'ignore')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const result = await service.importPaths([path.join(paths.dataRoot, 'drop')])
    assert.equal(result.errors.length, 0)
    assert.equal(result.entries.length, 1)
    assert.equal(path.basename(result.entries[0].sourcePath), otf)
    assert.equal(result.entries[0].status, 'uninstalled')
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('importPaths reports invalid web fonts without blocking other files', async () => {
  const paths = tempPaths()
  const webOnly = path.join(paths.dataRoot, 'web')
  const mixed = path.join(paths.dataRoot, 'mixed')
  fs.mkdirSync(webOnly, { recursive: true })
  fs.mkdirSync(mixed, { recursive: true })
  fs.writeFileSync(path.join(webOnly, 'Family.woff2'), 'font')
  fs.writeFileSync(path.join(mixed, 'Family.woff'), 'font')
  fs.writeFileSync(path.join(mixed, 'Regular.otf'), 'font')
  const service = new FontButlerService(paths)
  try {
    await service.init()
    const rejected = await service.importPaths([webOnly])
    assert.deepEqual(rejected.entries, [])
    assert.equal(rejected.errors.length, 1)

    const mixedResult = await service.importPaths([mixed])
    assert.equal(mixedResult.errors.length, 2)
    assert.equal(
      mixedResult.errors.some((message) => /WOFF files cannot be installed/.test(message)),
      false,
    )
  } finally {
    await closeAllWatchers()
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

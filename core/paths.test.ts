import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { FOLDER_MIGRATION_FILE, migrationStallMessage } from '../electron/mac-data-migration.mjs'
import {
  APP_FOLDER_NAME,
  LEGACY_APP_FOLDER_NAME,
  PREVIOUS_APP_FOLDER_NAME,
  buildPaths,
  isFreshDataRoot,
  migrateLegacyMacAppDirs,
} from './paths.ts'

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-paths-'))
}

test('FONT_BUTLER_DATA isolates user, computer, system, and cache directories', () => {
  const home = tempHome()
  const dataRoot = path.join(home, 'isolated-data')
  try {
    const paths = buildPaths({ home, override: dataRoot, mac: true })
    assert.equal(paths.dataRoot, dataRoot)
    assert.equal(paths.userFontsDir, path.join(dataRoot, 'user-fonts'))
    assert.equal(paths.installDir, path.join(dataRoot, 'user-fonts'))
    assert.equal(paths.computerFontsDir, path.join(dataRoot, 'computer-fonts'))
    assert.equal(paths.systemFontsDir, path.join(dataRoot, 'system-fonts'))
    assert.equal(paths.officeFontCacheDir, path.join(dataRoot, 'office-cache'))
    assert.equal(paths.atsCacheDir, path.join(dataRoot, 'ats-cache'))
    assert.equal(paths.adobeFontsDir, path.join(dataRoot, 'adobe-fonts'))
    assert.equal(paths.userFontsDir.includes('Library/Fonts'), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

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
            installations: [
              {
                destinationId: 'macos',
                path: path.join(legacyInstall, 'Family.otf'),
                parkedPath: path.join(legacyData, 'Disabled', 'Family.otf'),
              },
            ],
          },
        ],
      }),
    )
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')

    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, false)
    assert.equal(next.movedData, true)
    assert.equal(next.movedFonts, true)
    assert.equal(next.dataRoot, path.join(home, 'Library/Application Support', APP_FOLDER_NAME))
    assert.equal(next.installDir, path.join(home, 'Library/Fonts', APP_FOLDER_NAME))
    assert.equal(fs.existsSync(legacyData), false)
    assert.equal(fs.existsSync(legacyInstall), false)
    assert.equal(fs.existsSync(path.join(next.dataRoot, 'catalog.json')), true)
    assert.equal(fs.existsSync(path.join(next.installDir, 'Family.otf')), true)

    const catalog = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8'))
    assert.equal(catalog.entries[0].installedPath, path.join(next.installDir, 'Family.otf'))
    assert.equal(catalog.entries[0].disabledPath, path.join(next.dataRoot, 'Disabled', 'Family.otf'))
    assert.equal(catalog.entries[0].installations[0].path, path.join(next.installDir, 'Family.otf'))
    assert.equal(catalog.entries[0].installations[0].parkedPath, path.join(next.dataRoot, 'Disabled', 'Family.otf'))
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
    assert.equal(next.stalled, false)
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

    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, true)
    assert.equal(next.stalledDataDir, legacyData)
    assert.equal(next.movedData, false)
    const catalog = JSON.parse(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8'))
    assert.equal(catalog.entries[0].id, 'new')
    assert.equal(fs.existsSync(legacyData), true)
    assert.equal(fs.existsSync(path.join(nextData, FOLDER_MIGRATION_FILE)), false)
    assert.equal(isFreshDataRoot(nextData), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

function catalog(entries: unknown): string {
  return JSON.stringify({ version: 1, entries })
}

test('APP_FOLDER_NAME and a fresh Mac home resolve to Cuttler without a stall', () => {
  assert.equal(APP_FOLDER_NAME, 'Cuttler')
  assert.equal(PREVIOUS_APP_FOLDER_NAME, 'Font Buttler')
  const home = tempHome()
  try {
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, false)
    assert.equal(next.movedData, false)
    assert.equal(next.movedFonts, false)
    assert.equal(next.stalledDataDir, null)
    assert.equal(next.stalledFontsDir, null)
    assert.equal(next.dataRoot, path.join(home, 'Library/Application Support', 'Cuttler'))
    assert.equal(next.installDir, path.join(home, 'Library/Fonts', 'Cuttler'))
    assert.equal(fs.existsSync(next.dataRoot), false)
    assert.equal(fs.existsSync(next.installDir), false)
    assert.equal(buildPaths({ home, mac: true }).dataRoot, next.dataRoot)
    assert.equal(isFreshDataRoot(next.dataRoot), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('Font Buttler application support and fonts folders move to Cuttler and rewrite the catalog', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    fs.writeFileSync(
      path.join(legacyData, 'catalog.json'),
      catalog([
        {
          id: '1',
          sourcePath: path.join(legacyData, 'sources', 'Family.otf'),
          installedPath: path.join(legacyInstall, 'Family.otf'),
          disabledPath: path.join(legacyData, 'Disabled', 'Family.otf'),
          installations: [{ path: path.join(legacyInstall, 'Family.otf'), parkedPath: path.join(legacyData, 'Disabled', 'Family.otf') }],
        },
      ]),
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, false)
    assert.equal(next.movedData, true)
    assert.equal(next.movedFonts, true)
    assert.equal(fs.existsSync(legacyData), false)
    assert.equal(fs.existsSync(legacyInstall), false)
    assert.equal(fs.existsSync(path.join(next.installDir, 'Family.otf')), true)
    const row = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8')).entries[0]
    assert.equal(row.sourcePath, path.join(next.dataRoot, 'sources', 'Family.otf'))
    assert.equal(row.installedPath, path.join(next.installDir, 'Family.otf'))
    assert.equal(row.disabledPath, path.join(next.dataRoot, 'Disabled', 'Family.otf'))
    assert.equal(row.installations[0].path, path.join(next.installDir, 'Family.otf'))
    assert.equal(row.installations[0].parkedPath, path.join(next.dataRoot, 'Disabled', 'Family.otf'))
    assert.equal(fs.existsSync(path.join(next.dataRoot, FOLDER_MIGRATION_FILE)), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a Cuttler destination that already has data is left in place and stalled', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(nextData, { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.mkdirSync(nextInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'old' }]))
    fs.writeFileSync(path.join(legacyData, 'settings.json'), '{}')
    fs.writeFileSync(path.join(nextData, 'catalog.json'), catalog([{ id: 'new' }]))
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'old-font')
    fs.writeFileSync(path.join(nextInstall, 'Other.otf'), 'new-font')

    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, true)
    assert.equal(next.movedData, false)
    assert.equal(next.movedFonts, false)
    assert.equal(next.stalledDataDir, legacyData)
    assert.equal(next.stalledFontsDir, legacyInstall)
    assert.equal(next.dataOccupied, true)
    assert.equal(next.fontsOccupied, true)
    const stall = migrationStallMessage(next)
    assert.match(stall, /Application Support\/Font Buttler/)
    assert.match(stall, /Fonts\/Font Buttler/)
    assert.match(stall, /already had files in .*Application Support\/Cuttler/)
    assert.match(stall, /already had files in .*Fonts\/Cuttler/)
    assert.equal(fs.readFileSync(path.join(legacyData, 'catalog.json'), 'utf8').includes('"old"'), true)
    assert.equal(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8').includes('"new"'), true)
    assert.equal(fs.readFileSync(path.join(legacyInstall, 'Family.otf'), 'utf8'), 'old-font')
    assert.equal(fs.readFileSync(path.join(nextInstall, 'Other.otf'), 'utf8'), 'new-font')
    assert.equal(fs.existsSync(legacyData), true)
    assert.equal(fs.existsSync(legacyInstall), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('an empty fonts destination is replaced and a non-empty one stalls', () => {
  const home = tempHome()
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.mkdirSync(nextInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    const moved = migrateLegacyMacAppDirs(home)
    assert.equal(moved.stalled, false)
    assert.equal(moved.movedFonts, true)
    assert.equal(fs.existsSync(path.join(nextInstall, 'Family.otf')), true)
    assert.equal(fs.existsSync(legacyInstall), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }

  const blocked = tempHome()
  const oldFonts = path.join(blocked, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const newFonts = path.join(blocked, 'Library/Fonts', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(oldFonts, { recursive: true })
    fs.mkdirSync(newFonts, { recursive: true })
    fs.writeFileSync(path.join(oldFonts, 'Family.otf'), 'old-font')
    fs.writeFileSync(path.join(newFonts, 'Other.otf'), 'new-font')
    const next = migrateLegacyMacAppDirs(blocked)
    assert.equal(next.stalled, true)
    assert.equal(next.stalledFontsDir, oldFonts)
    assert.equal(next.stalledDataDir, null)
    assert.equal(fs.readFileSync(path.join(oldFonts, 'Family.otf'), 'utf8'), 'old-font')
    assert.equal(fs.readFileSync(path.join(newFonts, 'Other.otf'), 'utf8'), 'new-font')
  } finally {
    fs.rmSync(blocked, { recursive: true, force: true })
  }
})

test('a later launch does not stall on a lower-priority folder after Font Buttler moved', () => {
  const home = tempHome()
  const current = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const older = path.join(home, 'Library/Application Support', LEGACY_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(current, { recursive: true })
    fs.mkdirSync(older, { recursive: true })
    fs.writeFileSync(path.join(current, 'catalog.json'), catalog([{ id: 'current' }]))
    fs.writeFileSync(path.join(older, 'catalog.json'), catalog([{ id: 'older' }]))
    const first = migrateLegacyMacAppDirs(home)
    assert.equal(first.stalled, false)
    assert.equal(first.movedData, true)
    assert.equal(fs.existsSync(current), false)
    assert.equal(fs.existsSync(path.join(older, 'catalog.json')), true)
    assert.equal(JSON.parse(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8')).entries[0].id, 'current')
    const second = migrateLegacyMacAppDirs(home)
    assert.equal(second.stalled, false)
    assert.equal(second.movedData, false)
    assert.equal(fs.existsSync(path.join(older, 'catalog.json')), true)
    assert.equal(JSON.parse(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8')).entries[0].id, 'current')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a fonts move rewrites the catalog that stayed behind when application support stalled', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(nextData, { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    const installed = path.join(legacyInstall, 'Family.otf')
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'old', installedPath: installed }]))
    fs.writeFileSync(path.join(nextData, 'settings.json'), '{}')
    fs.writeFileSync(path.join(nextData, 'catalog.json'), catalog([{ id: 'new', installedPath: '/keep/this.otf' }]))
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, true)
    assert.equal(next.movedData, false)
    assert.equal(next.movedFonts, true)
    assert.equal(next.stalledDataDir, legacyData)
    const oldCatalog = JSON.parse(fs.readFileSync(path.join(legacyData, 'catalog.json'), 'utf8'))
    assert.equal(oldCatalog.entries[0].installedPath, path.join(next.installDir, 'Family.otf'))
    const newCatalog = JSON.parse(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8'))
    assert.equal(newCatalog.entries[0].id, 'new')
    assert.equal(newCatalog.entries[0].installedPath, '/keep/this.otf')
    assert.equal(fs.existsSync(path.join(next.installDir, 'Family.otf')), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a cross-device move copies, checks, and then removes the source', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(path.join(legacyData, 'sources'), { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'copied' }]))
    fs.writeFileSync(path.join(legacyData, 'sources', 'Family.otf'), 'font-bytes')
    const next = migrateLegacyMacAppDirs(home, {
      renameSync() {
        const error = new Error('cross device') as NodeJS.ErrnoException
        error.code = 'EXDEV'
        throw error
      },
    })
    assert.equal(next.movedData, true)
    assert.equal(next.stalled, false)
    assert.equal(fs.existsSync(legacyData), false)
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'sources', 'Family.otf'), 'utf8'), 'font-bytes')
    assert.equal(JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8')).entries[0].id, 'copied')
    const names = fs.readdirSync(next.dataRoot)
    assert.equal(names.some((name) => name.includes('.partial-') || name.includes('.tmp')), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a copy that does not match the source leaves the old folder in place', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'keep' }]))
    const next = migrateLegacyMacAppDirs(home, {
      renameSync() {
        const error = new Error('cross device') as NodeJS.ErrnoException
        error.code = 'EXDEV'
        throw error
      },
      copyFileSync(from, to) {
        fs.writeFileSync(to, `corrupt:${fs.readFileSync(from)}`)
      },
    })
    assert.equal(next.stalled, true)
    assert.equal(next.movedData, false)
    assert.equal(next.dataOccupied, false)
    assert.equal(next.stalledDataDir, legacyData)
    assert.equal(fs.existsSync(path.join(legacyData, 'catalog.json')), true)
    assert.equal(fs.existsSync(nextData), false)
    assert.match(migrationStallMessage(next), /did not finish/)
    assert.equal(migrationStallMessage(next).includes('already had files'), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('FONT_BUTLER_DATA does not move the Mac library folders', () => {
  const home = tempHome()
  const legacy = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const isolated = path.join(home, 'isolated')
  try {
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'catalog.json'), catalog([]))
    const paths = buildPaths({ home, override: isolated, mac: true })
    assert.equal(paths.dataRoot, isolated)
    assert.equal(fs.existsSync(path.join(legacy, 'catalog.json')), true)
    assert.equal(fs.existsSync(path.join(home, 'Library/Application Support', APP_FOLDER_NAME)), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

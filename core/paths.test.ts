import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { dismissAnnouncement, presentPendingAnnouncement } from '../electron/announcements.mjs'
import { FINDER_SYNC_PENDING_ERROR_FILE } from '../electron/finder-sync-pending-error.mjs'
import {
  FOLDER_MIGRATION_FILE,
  MIGRATION_DATA_ROOT_ENV,
  MIGRATION_HANDLED_ENV,
  MIGRATION_STALL_ENV,
  PENDING_MIGRATION_FILE,
  launchAfterMigrationFailure,
  isLegacyAppExecutable,
  legacyLibraryHasRunningOwner,
  legacyOwnerBlockMessage,
  migrationAnnouncementFlags,
  migrationStallMessage,
  readSingletonLockPid,
  singletonCookieHeld,
} from '../electron/mac-data-migration.mjs'
import {
  APP_FOLDER_NAME,
  LEGACY_APP_FOLDER_NAME,
  PREVIOUS_APP_FOLDER_NAME,
  buildPaths,
  isFreshDataRoot,
  migrateLegacyMacAppDirs,
  type AppPaths,
} from './paths.ts'
import { pruneStaleDuplicates } from './duplicates.ts'
import { isUnlinkedSource, recoverUnlinkedSources } from './unlinked-sources.ts'

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

test('a Finder Sync error written into a fresh Cuttler folder survives the library move', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(nextData, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: '1' }]))
    fs.writeFileSync(
      path.join(nextData, FINDER_SYNC_PENDING_ERROR_FILE),
      JSON.stringify({ errors: [{ code: 'missing-app', at: 4 }, { code: 'not-a-code', at: 1 }] }),
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.movedData, true)
    assert.equal(next.stalled, false)
    assert.equal(fs.existsSync(legacyData), false)
    const kept = JSON.parse(fs.readFileSync(path.join(next.dataRoot, FINDER_SYNC_PENDING_ERROR_FILE), 'utf8'))
    assert.deepEqual(kept.errors, [{ code: 'missing-app', at: 4 }])
    assert.equal(fs.lstatSync(path.join(next.dataRoot, FINDER_SYNC_PENDING_ERROR_FILE)).mode & 0o777, 0o600)
    const names = fs.readdirSync(path.join(home, 'Library/Application Support'))
    assert.equal(names.some((name) => name.startsWith(`${APP_FOLDER_NAME}.fresh-`)), false)

    const secretHome = tempHome()
    try {
      const secretLegacy = path.join(secretHome, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
      const secretNext = path.join(secretHome, 'Library/Application Support', APP_FOLDER_NAME)
      const secret = path.join(secretHome, 'secret.json')
      fs.mkdirSync(secretLegacy, { recursive: true })
      fs.mkdirSync(secretNext, { recursive: true })
      fs.writeFileSync(path.join(secretLegacy, 'catalog.json'), catalog([{ id: '1' }]))
      fs.writeFileSync(secret, JSON.stringify({ errors: [{ code: 'login-items', at: 1 }] }))
      fs.symlinkSync(secret, path.join(secretNext, FINDER_SYNC_PENDING_ERROR_FILE))
      const moved = migrateLegacyMacAppDirs(secretHome)
      assert.equal(moved.movedData, true)
      assert.equal(fs.existsSync(path.join(moved.dataRoot, FINDER_SYNC_PENDING_ERROR_FILE)), false)
      assert.match(fs.readFileSync(secret, 'utf8'), /login-items/)
    } finally {
      fs.rmSync(secretHome, { recursive: true, force: true })
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('an empty Font Buttler folder does not discard a queued Finder Sync error in Cuttler', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(nextData, { recursive: true })
    fs.writeFileSync(
      path.join(nextData, FINDER_SYNC_PENDING_ERROR_FILE),
      JSON.stringify({ errors: [{ code: 'not-running', at: 8 }] }),
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.movedData, true)
    assert.equal(fs.existsSync(legacyData), false)
    const kept = JSON.parse(fs.readFileSync(path.join(next.dataRoot, FINDER_SYNC_PENDING_ERROR_FILE), 'utf8'))
    assert.deepEqual(kept.errors, [{ code: 'not-running', at: 8 }])
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
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({ journals: [{ targets: [{ files: [{ snapshotPath: path.join(legacyData, 'journal', 'snap.otf') }] }] }] }),
    )
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
    assert.match(fs.readFileSync(path.join(legacyData, 'mutation-journal.json'), 'utf8'), /Font Buttler/)
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
    assert.equal(next.stalled, false)
    assert.equal(next.fontsRenameReason, 'occupied')
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
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({ journals: [{ targets: [{ files: [{ originalPath: installed }] }] }] }),
    )
    fs.writeFileSync(path.join(nextData, 'settings.json'), '{}')
    fs.writeFileSync(path.join(nextData, 'catalog.json'), catalog([{ id: 'new', installedPath: installed }]))
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, true)
    assert.equal(next.movedData, false)
    assert.equal(next.movedFonts, true)
    assert.equal(next.stalledDataDir, legacyData)
    const oldCatalog = JSON.parse(fs.readFileSync(path.join(legacyData, 'catalog.json'), 'utf8'))
    assert.equal(oldCatalog.entries[0].installedPath, path.join(next.installDir, 'Family.otf'))
    const oldJournal = JSON.parse(fs.readFileSync(path.join(legacyData, 'mutation-journal.json'), 'utf8'))
    assert.equal(oldJournal.journals[0].targets[0].files[0].originalPath, path.join(next.installDir, 'Family.otf'))
    const newCatalog = JSON.parse(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8'))
    assert.equal(newCatalog.entries[0].id, 'new')
    assert.equal(newCatalog.entries[0].installedPath, installed)
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

function listFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else out.push(path.relative(root, abs))
    }
  }
  if (fs.existsSync(root)) walk(root)
  return out.sort()
}

function exdevRename() {
  return (_from: string, _to: string) => {
    const error = new Error('cross device') as NodeJS.ErrnoException
    error.code = 'EXDEV'
    throw error
  }
}

test('an EXDEV copy that cannot finish deleting the source keeps the destination', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const snapshot = path.join(legacyData, 'journal', 'job', 'face.otf')
  try {
    fs.mkdirSync(path.join(legacyData, 'sources'), { recursive: true })
    fs.mkdirSync(path.dirname(snapshot), { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'sources', 'keep.otf'), 'keep-bytes')
    fs.writeFileSync(path.join(legacyData, 'sources', 'drop.otf'), 'drop-bytes')
    fs.writeFileSync(snapshot, 'snapshot-bytes')
    fs.writeFileSync(path.join(legacyInstall, 'keep.otf'), 'font-keep')
    fs.writeFileSync(path.join(legacyInstall, 'drop.otf'), 'font-drop')
    fs.writeFileSync(
      path.join(legacyData, 'catalog.json'),
      catalog([{ id: 'kept', installedPath: path.join(legacyInstall, 'keep.otf'), sourcePath: path.join(legacyData, 'sources', 'keep.otf') }]),
    )
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({ journals: [{ targets: [{ files: [{ snapshotPath: snapshot }] }] }] }),
    )
    const sourceCatalog = fs.readFileSync(path.join(legacyData, 'catalog.json'), 'utf8')
    let removals = 0
    const next = migrateLegacyMacAppDirs(home, {
      renameSync: exdevRename(),
      rmSync(target) {
        removals += 1
        const victim = [path.join(target, 'drop.otf'), path.join(target, 'sources', 'drop.otf')].find((file) =>
          fs.existsSync(file),
        )
        if (victim) fs.rmSync(victim)
        const error = new Error('partial delete') as NodeJS.ErrnoException
        error.code = 'EIO'
        throw error
      },
    })
    assert.equal(removals, 1)
    assert.equal(next.stalled, false)
    assert.equal(next.movedData, true)
    assert.equal(next.movedFonts, true)
    assert.equal(next.stalledDataDir, null)
    assert.equal(next.stalledFontsDir, null)
    assert.equal(next.leftoverDataDir, legacyData)
    assert.equal(next.leftoverFontsDir, null)
    assert.equal(next.dataRoot, path.join(home, 'Library/Application Support', APP_FOLDER_NAME))
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'sources', 'keep.otf'), 'utf8'), 'keep-bytes')
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'sources', 'drop.otf'), 'utf8'), 'drop-bytes')
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'journal', 'job', 'face.otf'), 'utf8'), 'snapshot-bytes')
    assert.equal(fs.readFileSync(path.join(next.installDir, 'keep.otf'), 'utf8'), 'font-keep')
    assert.equal(fs.readFileSync(path.join(next.installDir, 'drop.otf'), 'utf8'), 'font-drop')
    assert.equal(fs.existsSync(path.join(legacyData, 'sources', 'drop.otf')), false)
    assert.equal(fs.readFileSync(path.join(legacyData, 'sources', 'keep.otf'), 'utf8'), 'keep-bytes')
    assert.equal(fs.readFileSync(path.join(legacyData, 'catalog.json'), 'utf8'), sourceCatalog)
    assert.equal(fs.existsSync(legacyInstall), false)
    const catalogRow = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8')).entries[0]
    assert.equal(catalogRow.installedPath, path.join(next.installDir, 'keep.otf'))
    assert.equal(catalogRow.sourcePath, path.join(next.dataRoot, 'sources', 'keep.otf'))
    const journal = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'mutation-journal.json'), 'utf8'))
    assert.equal(journal.journals[0].targets[0].files[0].snapshotPath, path.join(next.dataRoot, 'journal', 'job', 'face.otf'))
    const notice = migrationStallMessage(next)
    assert.deepEqual(migrationAnnouncementFlags(next), { migrationStalled: false, migrationLeftover: true, fontsRenameReason: null })
    assert.match(notice, /is no longer used/)
    assert.match(notice, /You can remove it/)
    assert.match(notice, /Application Support\/Font Buttler/)
    assert.match(notice, /Application Support\/Cuttler/)
    assert.equal(notice.includes('still in'), false)
    const dataFiles = listFiles(legacyData)
    fs.writeFileSync(path.join(next.dataRoot, 'probe.txt'), 'do-not-overwrite')
    fs.writeFileSync(path.join(next.installDir, 'probe.txt'), 'do-not-overwrite')
    let renames = 0
    const again = migrateLegacyMacAppDirs(home, {
      renameSync(from, to) {
        renames += 1
        if (from === legacyData || from === legacyInstall) throw new Error(`refused to move leftover ${from}`)
        fs.renameSync(from, to)
      },
    })
    assert.equal(renames, 0)
    assert.equal(again.stalled, false)
    assert.equal(again.stalledDataDir, null)
    assert.equal(again.stalledFontsDir, null)
    assert.equal(again.leftoverDataDir, legacyData)
    assert.equal(again.leftoverFontsDir, null)
    assert.equal(again.dataRoot, next.dataRoot)
    assert.deepEqual(listFiles(legacyData), dataFiles)
    assert.equal(fs.existsSync(legacyInstall), false)
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'probe.txt'), 'utf8'), 'do-not-overwrite')
    assert.equal(fs.readFileSync(path.join(next.installDir, 'probe.txt'), 'utf8'), 'do-not-overwrite')
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'sources', 'drop.otf'), 'utf8'), 'drop-bytes')
    assert.equal(fs.readFileSync(path.join(next.installDir, 'drop.otf'), 'utf8'), 'font-drop')
    assert.equal(JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8')).entries[0].id, 'kept')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a crash after an EXDEV copy commit adopts the destination on the next launch', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const snapshot = path.join(legacyData, 'journal', 'job', 'face.otf')
  try {
    fs.mkdirSync(path.dirname(snapshot), { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(snapshot, 'snapshot-bytes')
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font-bytes')
    fs.writeFileSync(
      path.join(legacyData, 'catalog.json'),
      catalog([{ id: 'copied', installedPath: path.join(legacyInstall, 'Family.otf') }]),
    )
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({
        journals: [{ targets: [{ files: [{ snapshotPath: snapshot, originalPath: path.join(legacyInstall, 'Family.otf') }] }] }],
      }),
    )
    const sourceFiles = listFiles(legacyData)
    assert.throws(
      () => migrateLegacyMacAppDirs(home, { renameSync: exdevRename(), crashAfterCopyCommit: true }),
      /killed after the copy commit/,
    )
    const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
    assert.deepEqual(listFiles(legacyData), sourceFiles)
    assert.equal(fs.readFileSync(path.join(legacyData, 'journal', 'job', 'face.otf'), 'utf8'), 'snapshot-bytes')
    assert.equal(fs.readFileSync(path.join(dataRoot, 'journal', 'job', 'face.otf'), 'utf8'), 'snapshot-bytes')
    assert.equal(fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8').includes('copied'), true)
    assert.equal(fs.existsSync(legacyInstall), true)
    assert.equal(fs.existsSync(path.join(home, 'Library/Fonts', APP_FOLDER_NAME)), false)
    const pending = JSON.parse(fs.readFileSync(path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE), 'utf8'))
    assert.equal(pending.replacements.some((pair: { from: string; committed?: boolean }) => pair.from === legacyData && pair.committed === true), true)
    fs.writeFileSync(path.join(dataRoot, 'probe.txt'), 'do-not-overwrite')
    const next = migrateLegacyMacAppDirs(home, {
      renameSync(from, to) {
        if (from === legacyData) throw new Error('refused to move leftover data')
        fs.renameSync(from, to)
      },
    })
    assert.equal(next.stalled, false)
    assert.equal(next.stalledDataDir, null)
    assert.equal(next.leftoverDataDir, legacyData)
    assert.equal(next.leftoverFontsDir, null)
    assert.equal(next.movedFonts, true)
    assert.equal(next.dataRoot, dataRoot)
    assert.deepEqual(listFiles(legacyData), sourceFiles)
    assert.equal(fs.readFileSync(path.join(dataRoot, 'probe.txt'), 'utf8'), 'do-not-overwrite')
    assert.equal(fs.readFileSync(path.join(dataRoot, 'journal', 'job', 'face.otf'), 'utf8'), 'snapshot-bytes')
    assert.equal(fs.readFileSync(path.join(legacyData, 'journal', 'job', 'face.otf'), 'utf8'), 'snapshot-bytes')
    const row = JSON.parse(fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8')).entries[0]
    assert.equal(row.id, 'copied')
    assert.equal(row.installedPath, path.join(next.installDir, 'Family.otf'))
    const journal = JSON.parse(fs.readFileSync(path.join(dataRoot, 'mutation-journal.json'), 'utf8'))
    assert.equal(journal.journals[0].targets[0].files[0].snapshotPath, path.join(dataRoot, 'journal', 'job', 'face.otf'))
    assert.equal(journal.journals[0].targets[0].files[0].originalPath, path.join(next.installDir, 'Family.otf'))
    assert.equal(fs.readFileSync(path.join(next.installDir, 'Family.otf'), 'utf8'), 'font-bytes')
    assert.equal(fs.existsSync(legacyInstall), false)
    assert.match(fs.readFileSync(path.join(legacyData, 'catalog.json'), 'utf8'), /Font Buttler/)
    assert.deepEqual(migrationAnnouncementFlags(next), { migrationStalled: false, migrationLeftover: true, fontsRenameReason: null })
    assert.match(migrationStallMessage(next), /is no longer used/)
    assert.match(migrationStallMessage(next), /You can remove it/)
    assert.equal(migrationStallMessage(next).includes('Fonts in that folder may still be active'), false)
    assert.equal(migrationStallMessage(next).includes('still in'), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('an emptied destination does not adopt a committed leftover source', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(path.join(legacyData, 'sources'), { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'sources', 'a.otf'), 'a-bytes')
    fs.writeFileSync(path.join(legacyData, 'sources', 'b.otf'), 'b-bytes')
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'kept' }]))
    fs.writeFileSync(path.join(legacyData, 'settings.json'), '{"kept":true}')
    fs.writeFileSync(path.join(legacyInstall, 'a.otf'), 'font-a')
    fs.writeFileSync(path.join(legacyInstall, 'b.otf'), 'font-b')
    const first = migrateLegacyMacAppDirs(home, {
      renameSync: exdevRename(),
      rmSync(target) {
        const victim = [path.join(target, 'b.otf'), path.join(target, 'sources', 'b.otf')].find((file) =>
          fs.existsSync(file),
        )
        if (victim) fs.rmSync(victim)
        const error = new Error('partial delete') as NodeJS.ErrnoException
        error.code = 'EIO'
        throw error
      },
    })
    assert.equal(first.leftoverDataDir, legacyData)
    assert.equal(first.leftoverFontsDir, null)
    assert.equal(fs.existsSync(legacyInstall), false)
    fs.rmSync(path.join(first.dataRoot, 'catalog.json'))
    fs.rmSync(path.join(first.dataRoot, 'settings.json'))
    fs.writeFileSync(path.join(first.dataRoot, 'probe.txt'), 'leave-this')
    fs.rmSync(first.installDir, { recursive: true, force: true })
    const sourceDataFiles = listFiles(legacyData)
    let renames = 0
    const again = migrateLegacyMacAppDirs(home, {
      renameSync(from, to) {
        renames += 1
        if (from === legacyData || from === legacyInstall) throw new Error(`refused to move leftover ${from}`)
        fs.renameSync(from, to)
      },
    })
    assert.equal(renames, 0)
    assert.equal(again.stalled, false)
    assert.equal(again.stalledDataDir, null)
    assert.equal(again.stalledFontsDir, null)
    assert.equal(again.leftoverDataDir, legacyData)
    assert.equal(again.leftoverFontsDir, null)
    assert.deepEqual(listFiles(legacyData), sourceDataFiles)
    assert.equal(fs.existsSync(path.join(legacyData, 'sources', 'b.otf')), false)
    assert.equal(fs.readFileSync(path.join(legacyData, 'sources', 'a.otf'), 'utf8'), 'a-bytes')
    assert.equal(fs.existsSync(path.join(first.installDir, 'a.otf')), false)
    assert.equal(fs.existsSync(path.join(first.dataRoot, 'catalog.json')), false)
    assert.equal(fs.readFileSync(path.join(first.dataRoot, 'probe.txt'), 'utf8'), 'leave-this')
    const emptied = migrationStallMessage(again)
    assert.match(emptied, /is empty/)
    assert.match(emptied, /Application Support\/Font Buttler/)
    assert.equal(emptied.includes('can be removed'), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

function fileBytes(root: string): Record<string, string> {
  const bytes: Record<string, string> = {}
  for (const name of listFiles(root)) bytes[name] = fs.readFileSync(path.join(root, name), 'utf8')
  return bytes
}

function assertUncommittedCopyStalls(
  hook: 'crashBeforeCommitRecord' | 'failCommitRecord',
  differ: boolean,
) {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const oldFont = path.join(legacyInstall, 'Family.otf')
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'copied', installedPath: oldFont }]))
    fs.writeFileSync(path.join(legacyData, 'keep.otf'), 'keep')
    fs.writeFileSync(oldFont, 'font-bytes')
    const pattern = hook === 'crashBeforeCommitRecord' ? /killed before the copy commit record/ : /commit record failed/
    assert.throws(() => migrateLegacyMacAppDirs(home, { renameSync: exdevRename(), [hook]: true }), pattern)
    const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
    if (differ) fs.writeFileSync(path.join(dataRoot, 'Preferences'), 'chromium')
    const sourceBefore = fileBytes(legacyData)
    const destBefore = fileBytes(dataRoot)
    const fontsBefore = fileBytes(legacyInstall)
    const pendingPath = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
    const pendingBefore = JSON.parse(fs.readFileSync(pendingPath, 'utf8'))
    assert.equal(
      pendingBefore.replacements.some((pair: { committed?: boolean }) => pair.committed === true),
      false,
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, true)
    assert.equal(next.leftoverDataDir, null)
    assert.equal(next.movedData, false)
    assert.equal(next.movedFonts, false)
    assert.equal(next.stalledDataDir, legacyData)
    assert.equal(next.stalledFontsDir, null)
    assert.deepEqual(fileBytes(legacyData), sourceBefore)
    assert.deepEqual(fileBytes(dataRoot), destBefore)
    assert.deepEqual(fileBytes(legacyInstall), fontsBefore)
    assert.equal(fs.existsSync(path.join(home, 'Library/Fonts', APP_FOLDER_NAME)), false)
    const kept = JSON.parse(fs.readFileSync(path.join(legacyData, 'catalog.json'), 'utf8')).entries[0]
    const copied = JSON.parse(fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8')).entries[0]
    assert.equal(kept.installedPath, oldFont)
    assert.equal(copied.installedPath, oldFont)
    const notice = migrationStallMessage(next)
    assert.match(notice, /unfinished copy/)
    assert.match(notice, /can be removed/)
    assert.equal(notice.includes('already had files'), false)
    assert.equal(notice.includes('did not finish'), false)
    const pendingAfter = JSON.parse(fs.readFileSync(pendingPath, 'utf8'))
    assert.equal(
      pendingAfter.replacements.some((pair: { committed?: boolean }) => pair.committed === true),
      false,
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

test('a crash before the commit record stalls and leaves both folders untouched', () => {
  assertUncommittedCopyStalls('crashBeforeCommitRecord', false)
  assertUncommittedCopyStalls('crashBeforeCommitRecord', true)
})

test('a failed commit record stalls and leaves both folders untouched', () => {
  assertUncommittedCopyStalls('failCommitRecord', false)
  assertUncommittedCopyStalls('failCommitRecord', true)
})

test('a fonts rename writes the intent before the rename and recovers a kill after it', () => {
  const home = tempHome()
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const fontPath = path.join(legacyInstall, 'a.otf')
  const pendingPath = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(fontPath, 'a')
    fs.writeFileSync(path.join(dataRoot, 'catalog.json'), catalog([{ id: 'a', installedPath: fontPath }]))
    fs.writeFileSync(path.join(dataRoot, 'settings.json'), '{}\n')
    assert.throws(
      () =>
        migrateLegacyMacAppDirs(home, {
          fontRenameSync(from, to) {
            const recorded = JSON.parse(fs.readFileSync(pendingPath, 'utf8')).replacements.find(
              (item: { phase?: string }) => item.phase === 'renaming',
            )
            assert.equal(recorded?.phase, 'renaming')
            fs.renameSync(from, to)
            const killed = new Error('killed after the fonts rename') as NodeJS.ErrnoException
            killed.code = 'EFONTRENAME'
            throw killed
          },
        }),
      /fonts rename/,
    )
    assert.equal(fs.existsSync(legacyInstall), false)
    assert.equal(fs.readFileSync(path.join(nextInstall, 'a.otf'), 'utf8'), 'a')
    const readPath = () =>
      JSON.parse(fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8')).entries[0].installedPath
    assert.equal(readPath(), fontPath)
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.movedFonts, true)
    assert.equal(readPath(), path.join(nextInstall, 'a.otf'))
    assert.equal(fs.readFileSync(path.join(nextInstall, 'a.otf'), 'utf8'), 'a')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a fonts rename that hits EXDEV or EACCES leaves the folder and the catalog', () => {
  for (const code of ['EXDEV', 'EACCES', 'EPERM'] as const) {
    const home = tempHome()
    const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
    const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
    const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
    const fontPath = path.join(legacyInstall, 'a.otf')
    try {
      fs.mkdirSync(dataRoot, { recursive: true })
      fs.mkdirSync(legacyInstall, { recursive: true })
      fs.writeFileSync(fontPath, 'a')
      fs.writeFileSync(path.join(dataRoot, 'catalog.json'), catalog([{ id: 'a', installedPath: fontPath }]))
      fs.writeFileSync(path.join(dataRoot, 'settings.json'), '{}\n')
      const first = migrateLegacyMacAppDirs(home, {
        fontRenameSync() {
          const error = new Error(code) as NodeJS.ErrnoException
          error.code = code
          throw error
        },
      })
      assert.equal(first.movedFonts, false)
      assert.equal(first.stalled, false)
      assert.equal(first.fontsRenameReason, code)
      assert.equal(fs.readFileSync(fontPath, 'utf8'), 'a')
      assert.equal(fs.existsSync(nextInstall), false)
      const readPath = () =>
        JSON.parse(fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8')).entries[0].installedPath
      assert.equal(readPath(), fontPath)
      assert.match(migrationStallMessage(first), /Nothing was copied or removed/)
      assert.match(migrationStallMessage(first), /Font Buttler/)
      const second = migrateLegacyMacAppDirs(home)
      assert.equal(second.movedFonts, true)
      assert.equal(readPath(), path.join(nextInstall, 'a.otf'))
      assert.equal(fs.readFileSync(path.join(nextInstall, 'a.otf'), 'utf8'), 'a')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  }
})

test('an empty Fonts/Cuttler is removed with rmdir and a folder with files is left', () => {
  const home = tempHome()
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.mkdirSync(nextInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'a.otf'), 'a')
    const moved = migrateLegacyMacAppDirs(home)
    assert.equal(moved.movedFonts, true)
    assert.equal(fs.existsSync(legacyInstall), false)
    assert.equal(fs.readFileSync(path.join(nextInstall, 'a.otf'), 'utf8'), 'a')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
  const occupied = tempHome()
  const oldFonts = path.join(occupied, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const newFonts = path.join(occupied, 'Library/Fonts', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(oldFonts, { recursive: true })
    fs.mkdirSync(newFonts, { recursive: true })
    fs.writeFileSync(path.join(oldFonts, 'a.otf'), 'a')
    fs.writeFileSync(path.join(newFonts, 'mine.otf'), 'mine')
    const stalled = migrateLegacyMacAppDirs(occupied)
    assert.equal(stalled.movedFonts, false)
    assert.equal(stalled.stalled, false)
    assert.equal(stalled.fontsRenameReason, 'occupied')
    assert.equal(fs.readFileSync(path.join(oldFonts, 'a.otf'), 'utf8'), 'a')
    assert.equal(fs.readFileSync(path.join(newFonts, 'mine.otf'), 'utf8'), 'mine')
    assert.match(migrationStallMessage(stalled), /already has files/)
  } finally {
    fs.rmSync(occupied, { recursive: true, force: true })
  }
})

test('a forged font record and a symlink source are not renamed', () => {
  const home = tempHome()
  const evil = path.join(home, 'evil-fonts')
  const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(evil, { recursive: true })
    fs.writeFileSync(path.join(evil, 'a.otf'), 'a')
    fs.mkdirSync(path.dirname(pending), { recursive: true })
    fs.writeFileSync(
      pending,
      JSON.stringify({
        version: 1,
        needsRewrite: true,
        replacements: [{ from: evil, to: nextInstall, phase: 'renaming', committed: false }],
        dataRoot: path.join(home, 'Library/Application Support', APP_FOLDER_NAME),
      }),
    )
    const refused = migrateLegacyMacAppDirs(home)
    assert.equal(refused.movedFonts, false)
    assert.equal(fs.readFileSync(path.join(evil, 'a.otf'), 'utf8'), 'a')
    assert.equal(fs.existsSync(path.join(nextInstall, 'a.otf')), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
  const linked = tempHome()
  const target = path.join(linked, 'real-fonts')
  const link = path.join(linked, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'a.otf'), 'a')
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link)
    const stalled = migrateLegacyMacAppDirs(linked)
    assert.equal(stalled.movedFonts, false)
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true)
    assert.equal(fs.readFileSync(path.join(target, 'a.otf'), 'utf8'), 'a')
    assert.match(migrationStallMessage(stalled), /Nothing was copied or removed/)
  } finally {
    fs.rmSync(linked, { recursive: true, force: true })
  }
})

test('an old committed font record with both folders is not deleted', () => {
  const home = tempHome()
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  const fresh = path.join(home, 'Library/Fonts', 'Cuttler.fresh-1-2')
  const partial = path.join(home, 'Library', '.cuttler-move.partial-3-4')
  try {
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.mkdirSync(nextInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'a.otf'), 'a')
    fs.writeFileSync(path.join(nextInstall, 'b.otf'), 'b')
    fs.mkdirSync(fresh)
    fs.mkdirSync(partial, { recursive: true })
    fs.writeFileSync(path.join(partial, '.cuttler-partial.json'), '{"pid":1}\n')
    fs.writeFileSync(path.join(partial, 'kept.otf'), 'kept')
    fs.mkdirSync(path.dirname(pending), { recursive: true })
    fs.writeFileSync(
      pending,
      JSON.stringify({
        version: 1,
        needsRewrite: true,
        replacements: [{ from: legacyInstall, to: nextInstall, committed: true }],
        dataRoot: path.join(home, 'Library/Application Support', APP_FOLDER_NAME),
      }),
    )
    const result = migrateLegacyMacAppDirs(home)
    assert.equal(result.movedFonts, false)
    assert.equal(fs.readFileSync(path.join(legacyInstall, 'a.otf'), 'utf8'), 'a')
    assert.equal(fs.readFileSync(path.join(nextInstall, 'b.otf'), 'utf8'), 'b')
    assert.equal(fs.existsSync(fresh), false)
    assert.equal(fs.existsSync(partial), false)
    assert.equal(
      fs.readFileSync(
        path.join(home, 'Library/Application Support', APP_FOLDER_NAME, 'Leftovers', '.cuttler-move.partial-3-4', 'kept.otf'),
        'utf8',
      ),
      'kept',
    )
    assert.match(migrationStallMessage(result), /Leftovers/)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a second instance does not show a leftover notice', () => {
  assert.deepEqual(
    migrationAnnouncementFlags({
      blockedByOwner: true,
      stalled: false,
      leftoverFontsDir: '/Users/me/Library/Fonts/Font Buttler',
      leftoverDataDir: '/Users/me/Library/Application Support/Font Buttler',
    }),
    { migrationStalled: false, migrationLeftover: false, fontsRenameReason: null },
  )
  assert.deepEqual(
    migrationAnnouncementFlags({
      runningInstanceDataDir: '/Users/me/Library/Application Support/Font Buttler',
      stalled: true,
      leftoverFontsDir: '/Users/me/Library/Fonts/Font Buttler',
    }),
    { migrationStalled: false, migrationLeftover: false, fontsRenameReason: null },
  )
})

test('the fonts rename removes an empty directory only with rmdir', () => {
  const source = fs.readFileSync(new URL('../electron/mac-data-migration.mjs', import.meta.url), 'utf8')
  const rmdir = source.slice(source.indexOf('function rmdirEmptyPlainDir'), source.indexOf('function updateFontPair'))
  const rename = source.slice(source.indexOf('function renameLegacyFonts'), source.indexOf('export function migrateLegacyMacAppDirs'))
  assert.match(rmdir, /fs\.rmdirSync\(dir\)/)
  assert.equal(rmdir.includes('rmSync'), false)
  assert.equal(rename.includes('rmSync'), false)
  assert.equal(rename.includes('copyTree'), false)
})

test('symlinked Fonts and Application Support keep lexical catalog paths that exist', () => {
  for (const which of ['Fonts', 'Application Support'] as const) {
    const home = tempHome()
    const realRoot = path.join(home, `real-${which.replace(/\s/g, '-')}`)
    const link = path.join(home, 'Library', which)
    const legacy = path.join(link, PREVIOUS_APP_FOLDER_NAME)
    const dest = path.join(link, APP_FOLDER_NAME)
    try {
      fs.mkdirSync(path.join(realRoot, PREVIOUS_APP_FOLDER_NAME), { recursive: true })
      fs.mkdirSync(path.dirname(link), { recursive: true })
      fs.symlinkSync(realRoot, link)
      const fontFile = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME, 'a.otf')
      const dataDir = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
      fs.mkdirSync(path.dirname(fontFile), { recursive: true })
      fs.writeFileSync(fontFile, 'a')
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(
        path.join(dataDir, 'catalog.json'),
        catalog([{ id: 'a', installedPath: path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME, 'a.otf') }]),
      )
      fs.writeFileSync(path.join(dataDir, 'settings.json'), '{}\n')
      const next = migrateLegacyMacAppDirs(home)
      assert.equal(next.stalled, false)
      const catalogPath = path.join(home, 'Library/Application Support', APP_FOLDER_NAME, 'catalog.json')
      const installed = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).entries[0].installedPath
      const lexicalFont = path.join(home, 'Library/Fonts', APP_FOLDER_NAME, 'a.otf')
      assert.equal(installed, lexicalFont)
      assert.equal(fs.existsSync(installed), true)
      assert.equal(fs.existsSync(path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME, 'a.otf')), false)
      if (which === 'Fonts') assert.notEqual(fs.realpathSync(dest), dest)
      else assert.notEqual(fs.realpathSync(path.join(home, 'Library/Application Support', APP_FOLDER_NAME)), path.join(home, 'Library/Application Support', APP_FOLDER_NAME))
      assert.equal(legacy.includes(which) || true, true)
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  }
})

test('a fonts rename block is shown once per reason and a stray Font Butler folder does not stall', () => {
  const home = tempHome()
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const stray = path.join(home, 'Library/Fonts', LEGACY_APP_FOLDER_NAME)
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.mkdirSync(stray, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'a.otf'), 'a')
    fs.writeFileSync(path.join(stray, 'stray.otf'), 'stray')
    fs.writeFileSync(
      path.join(dataRoot, 'catalog.json'),
      catalog([{ id: 'a', installedPath: path.join(legacyInstall, 'a.otf') }]),
    )
    fs.writeFileSync(path.join(dataRoot, 'settings.json'), '{}\n')
    const moved = migrateLegacyMacAppDirs(home, {
      fontRenameSync() {
        const error = new Error('cross device') as NodeJS.ErrnoException
        error.code = 'EXDEV'
        throw error
      },
    })
    assert.equal(moved.stalled, false)
    assert.equal(moved.fontsRenameReason, 'EXDEV')
    assert.equal(fs.readFileSync(path.join(stray, 'stray.otf'), 'utf8'), 'stray')
    const flags = migrationAnnouncementFlags(moved)
    const shown = presentPendingAnnouncement({
      userDataDir: dataRoot,
      currentVersion: '0.4.1',
      migrationStalled: flags.migrationStalled,
      migrationLeftover: flags.migrationLeftover,
      fontsRenameReason: flags.fontsRenameReason,
      migration: moved,
    })
    assert.equal(shown?.id, 'fonts-rename-EXDEV')
    dismissAnnouncement({ userDataDir: dataRoot, id: shown?.id ?? '' })
    const again = migrateLegacyMacAppDirs(home, {
      fontRenameSync() {
        const error = new Error('cross device') as NodeJS.ErrnoException
        error.code = 'EXDEV'
        throw error
      },
    })
    const quiet = presentPendingAnnouncement({
      userDataDir: dataRoot,
      currentVersion: '0.4.1',
      ...migrationAnnouncementFlags(again),
      migration: again,
    })
    assert.notEqual(quiet?.id, 'fonts-rename-EXDEV')
    const changed = migrateLegacyMacAppDirs(home, {
      fontRenameSync() {
        const error = new Error('denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      },
    })
    const nextNotice = presentPendingAnnouncement({
      userDataDir: dataRoot,
      currentVersion: '0.4.1',
      ...migrationAnnouncementFlags(changed),
      migration: changed,
    })
    assert.equal(nextNotice?.id, 'fonts-rename-EACCES')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
  const both = tempHome()
  const buttler = path.join(both, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const butler = path.join(both, 'Library/Fonts', LEGACY_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(path.join(both, 'Library/Application Support', APP_FOLDER_NAME), { recursive: true })
    fs.writeFileSync(path.join(both, 'Library/Application Support', APP_FOLDER_NAME, 'settings.json'), '{}\n')
    fs.mkdirSync(buttler, { recursive: true })
    fs.mkdirSync(butler, { recursive: true })
    fs.writeFileSync(path.join(buttler, 'a.otf'), 'a')
    fs.writeFileSync(path.join(butler, 'stray.otf'), 'stray')
    const first = migrateLegacyMacAppDirs(both)
    assert.equal(first.stalled, false)
    assert.equal(first.fontsRenameReason, null)
    assert.equal(fs.readFileSync(path.join(both, 'Library/Fonts', APP_FOLDER_NAME, 'a.otf'), 'utf8'), 'a')
    assert.equal(fs.readFileSync(path.join(butler, 'stray.otf'), 'utf8'), 'stray')
    const second = migrateLegacyMacAppDirs(both)
    assert.equal(second.stalled, false)
    assert.equal(second.fontsRenameReason, null)
    assert.equal(fs.readFileSync(path.join(butler, 'stray.otf'), 'utf8'), 'stray')
  } finally {
    fs.rmSync(both, { recursive: true, force: true })
  }
})

test('a legacy from-to record recovers a finished fonts rename and a bad dest does not throw', () => {
  const home = tempHome()
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.mkdirSync(nextInstall, { recursive: true })
    fs.writeFileSync(path.join(nextInstall, 'a.otf'), 'a')
    fs.writeFileSync(
      path.join(dataRoot, 'catalog.json'),
      catalog([{ id: 'a', installedPath: path.join(legacyInstall, 'a.otf') }]),
    )
    fs.writeFileSync(path.join(dataRoot, 'settings.json'), '{}\n')
    fs.writeFileSync(
      pending,
      JSON.stringify({
        version: 1,
        needsRewrite: true,
        replacements: [{ from: legacyInstall, to: nextInstall }],
        dataRoot,
      }),
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.movedFonts, true)
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8')).entries[0].installedPath,
      path.join(nextInstall, 'a.otf'),
    )
    assert.equal(fs.existsSync(path.join(nextInstall, 'a.otf')), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
  for (const kind of ['symlink', 'file'] as const) {
    const blocked = tempHome()
    const source = path.join(blocked, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
    const dest = path.join(blocked, 'Library/Fonts', APP_FOLDER_NAME)
    try {
      fs.mkdirSync(source, { recursive: true })
      fs.writeFileSync(path.join(source, 'a.otf'), 'a')
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      if (kind === 'symlink') fs.symlinkSync(path.join(blocked, 'missing-target'), dest)
      else fs.writeFileSync(dest, 'not a folder')
      const result = migrateLegacyMacAppDirs(blocked)
      assert.equal(result.movedFonts, false)
      assert.equal(result.stalled, false)
      assert.equal(result.fontsRenameReason === 'symlink' || result.fontsRenameReason === 'file', true)
      assert.equal(fs.readFileSync(path.join(source, 'a.otf'), 'utf8'), 'a')
      assert.equal(launchAfterMigrationFailure(blocked).blockWorker, false)
      const record = path.join(blocked, 'Library/Application Support', PENDING_MIGRATION_FILE)
      if (fs.existsSync(record)) {
        const body = JSON.parse(fs.readFileSync(record, 'utf8'))
        assert.equal((body.replacements ?? []).some((item: { phase?: string }) => item.phase === 'renaming'), false)
      }
    } finally {
      fs.rmSync(blocked, { recursive: true, force: true })
    }
  }
})

test('Finder metadata in an empty fonts folder is unlinked and a forged record is dropped', () => {
  const home = tempHome()
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.mkdirSync(nextInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'a.otf'), 'a')
    fs.writeFileSync(path.join(nextInstall, '.DS_Store'), 'store')
    fs.writeFileSync(path.join(nextInstall, '.localized'), '')
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.movedFonts, true)
    assert.equal(fs.readFileSync(path.join(nextInstall, 'a.otf'), 'utf8'), 'a')
    assert.equal(fs.existsSync(path.join(nextInstall, '.DS_Store')), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
  const forged = tempHome()
  const evil = path.join(forged, 'evil-fonts')
  const pending = path.join(forged, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(evil, { recursive: true })
    fs.writeFileSync(path.join(evil, 'a.otf'), 'a')
    fs.mkdirSync(path.dirname(pending), { recursive: true })
    fs.writeFileSync(
      pending,
      JSON.stringify({
        version: 1,
        needsRewrite: true,
        replacements: [{ from: evil, to: path.join(forged, 'Library/Fonts', APP_FOLDER_NAME), phase: 'renaming' }],
        dataRoot: path.join(forged, 'Library/Application Support', APP_FOLDER_NAME),
      }),
    )
    const logs: string[] = []
    const write = console.error
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    }
    try {
      const first = migrateLegacyMacAppDirs(forged)
      assert.equal(first.stalled, false)
      assert.equal(first.fontsRenameReason, null)
      assert.equal(migrationStallMessage(first), '')
      const second = migrateLegacyMacAppDirs(forged)
      assert.equal(migrationStallMessage(second), '')
    } finally {
      console.error = write
    }
    assert.equal(logs.some((line) => line.includes('Dropping a font migration record')), true)
    assert.equal(fs.readFileSync(path.join(evil, 'a.otf'), 'utf8'), 'a')
    assert.equal(fs.existsSync(pending), false)
  } finally {
    fs.rmSync(forged, { recursive: true, force: true })
  }
})

test('font partials inside Library/Fonts are moved aside and foreign names stay', () => {
  const home = tempHome()
  const fonts = path.join(home, 'Library/Fonts')
  const support = path.join(home, 'Library/Application Support')
  const legacy = path.join(support, PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'catalog.json'), catalog([]))
    const live = path.join(fonts, 'Cuttler.partial-4-9')
    fs.mkdirSync(live, { recursive: true })
    fs.writeFileSync(path.join(live, 'a.otf'), 'dup')
    const foreign = path.join(fonts, 'MyCuttler.partial-1-2')
    fs.mkdirSync(foreign, { recursive: true })
    fs.writeFileSync(path.join(foreign, 'keep.otf'), 'keep')
    const extra = path.join(fonts, 'Cuttler.partial-1-2-extra')
    fs.mkdirSync(extra, { recursive: true })
    fs.writeFileSync(path.join(extra, 'keep.otf'), 'keep')
    const libraryPartial = path.join(support, 'Cuttler.partial-8-8')
    fs.mkdirSync(libraryPartial, { recursive: true })
    fs.writeFileSync(path.join(libraryPartial, '.cuttler-partial.json'), '{"pid":1}\n')
    fs.writeFileSync(path.join(libraryPartial, 'half.json'), '{}')
    const result = migrateLegacyMacAppDirs(home)
    assert.equal(fs.existsSync(live), false)
    assert.equal(fs.readFileSync(path.join(support, APP_FOLDER_NAME, 'Leftovers', 'Cuttler.partial-4-9', 'a.otf'), 'utf8'), 'dup')
    assert.equal(fs.readFileSync(path.join(foreign, 'keep.otf'), 'utf8'), 'keep')
    assert.equal(fs.readFileSync(path.join(extra, 'keep.otf'), 'utf8'), 'keep')
    assert.equal(fs.existsSync(libraryPartial), false)
    assert.match(migrationStallMessage(result), /Leftovers/)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('an old committed pair with both font folders is kept and said once', () => {
  const home = tempHome()
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const nextInstall = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.mkdirSync(nextInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'a.otf'), 'old')
    fs.writeFileSync(path.join(nextInstall, 'a.otf'), 'new')
    fs.writeFileSync(path.join(dataRoot, 'settings.json'), '{}\n')
    fs.writeFileSync(
      pending,
      JSON.stringify({
        version: 1,
        needsRewrite: true,
        replacements: [{ from: legacyInstall, to: nextInstall, committed: true }],
        dataRoot,
      }),
    )
    const first = migrateLegacyMacAppDirs(home)
    assert.equal(first.fontsRenameReason, 'old-head')
    assert.equal(fs.readFileSync(path.join(legacyInstall, 'a.otf'), 'utf8'), 'old')
    assert.equal(fs.readFileSync(path.join(nextInstall, 'a.otf'), 'utf8'), 'new')
    const notice = migrationStallMessage(first)
    assert.match(notice, /nothing was deleted/)
    assert.match(notice, /Font Buttler/)
    assert.match(notice, /Cuttler/)
    const flags = migrationAnnouncementFlags(first)
    const shown = presentPendingAnnouncement({
      userDataDir: dataRoot,
      currentVersion: '0.4.1',
      ...flags,
      migration: first,
    })
    assert.equal(shown?.id, 'fonts-rename-old-head')
    dismissAnnouncement({ userDataDir: dataRoot, id: 'fonts-rename-old-head' })
    const second = migrateLegacyMacAppDirs(home)
    const quiet = presentPendingAnnouncement({
      userDataDir: dataRoot,
      currentVersion: '0.4.1',
      ...migrationAnnouncementFlags(second),
      migration: second,
    })
    assert.notEqual(quiet?.id, 'fonts-rename-old-head')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('launch does not hash or compare library trees to recover an uncommitted copy', () => {
  const source = fs.readFileSync(new URL('../electron/mac-data-migration.mjs', import.meta.url), 'utf8')
  assert.equal(source.includes('confirmVerifiedCopies'), false)
  assert.deepEqual(source.match(/directoryTreesMatch\(/g), ['directoryTreesMatch(', 'directoryTreesMatch('])
  assert.match(source, /directoryTreesMatch\(from, tmp\)/)
})

test('a folder move rewrites mutation journal snapshot, destination, and catalog paths', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const snapshot = path.join(legacyData, 'journal', 'job', 'entry', 'macos-live.otf')
  try {
    fs.mkdirSync(path.dirname(snapshot), { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(snapshot, 'original-bytes')
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'live-bytes')
    fs.mkdirSync(path.join(legacyData, 'plans'), { recursive: true })
    fs.writeFileSync(
      path.join(legacyData, 'operations.json'),
      JSON.stringify({
        operations: [
          {
            destination: path.join(legacyInstall, 'Family.otf'),
            items: [
              {
                expectedSourcePath: path.join(legacyData, 'sources', 'Family.otf'),
                previousSourcePath: '/Users/you/Inbox/Family.otf',
                previousEntry: { installedPath: path.join(legacyInstall, 'Family.otf') },
              },
            ],
          },
        ],
      }),
    )
    fs.writeFileSync(
      path.join(legacyData, 'settings.json'),
      JSON.stringify({
        watchFolders: [legacyInstall, '/Users/you/Inbox'],
        folders: [{ root: path.join(legacyData, 'sources') }],
      }),
    )
    fs.writeFileSync(
      path.join(legacyData, 'retail-manifest.json'),
      JSON.stringify({ files: { 'Family.otf': { installedPath: path.join(legacyInstall, 'Family.otf'), relativePath: 'Family.otf' } } }),
    )
    fs.writeFileSync(
      path.join(legacyData, 'plans', 'plan.json'),
      JSON.stringify({ items: [{ path: path.join(legacyInstall, 'Family.otf') }] }),
    )
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({
        version: 1,
        journals: [
          {
            id: 'job',
            phase: 'mutating',
            targets: [
              {
                destPaths: [path.join(legacyInstall, 'Family.otf'), path.join(legacyData, 'Disabled', 'Family.otf')],
                entryBefore: {
                  installedPath: path.join(legacyInstall, 'Family.otf'),
                  disabledPath: path.join(legacyData, 'Disabled', 'Family.otf'),
                  installations: [{ path: path.join(legacyInstall, 'Family.otf') }],
                },
                files: [
                  {
                    originalPath: path.join(legacyInstall, 'Family.otf'),
                    snapshotPath: snapshot,
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, false)
    const journal = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'mutation-journal.json'), 'utf8'))
    const target = journal.journals[0].targets[0]
    const movedSnapshot = path.join(next.dataRoot, 'journal', 'job', 'entry', 'macos-live.otf')
    assert.equal(target.files[0].snapshotPath, movedSnapshot)
    assert.equal(target.files[0].originalPath, path.join(next.installDir, 'Family.otf'))
    assert.deepEqual(target.destPaths, [
      path.join(next.installDir, 'Family.otf'),
      path.join(next.dataRoot, 'Disabled', 'Family.otf'),
    ])
    assert.equal(target.entryBefore.installedPath, path.join(next.installDir, 'Family.otf'))
    assert.equal(target.entryBefore.disabledPath, path.join(next.dataRoot, 'Disabled', 'Family.otf'))
    assert.equal(target.entryBefore.installations[0].path, path.join(next.installDir, 'Family.otf'))
    assert.equal(fs.readFileSync(movedSnapshot, 'utf8'), 'original-bytes')
    assert.equal(fs.existsSync(snapshot), false)
    const operations = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'operations.json'), 'utf8'))
    assert.equal(operations.operations[0].destination, path.join(next.installDir, 'Family.otf'))
    assert.equal(operations.operations[0].items[0].expectedSourcePath, path.join(next.dataRoot, 'sources', 'Family.otf'))
    assert.equal(operations.operations[0].items[0].previousSourcePath, '/Users/you/Inbox/Family.otf')
    assert.equal(operations.operations[0].items[0].previousEntry.installedPath, path.join(next.installDir, 'Family.otf'))
    const settings = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'settings.json'), 'utf8'))
    assert.deepEqual(settings.watchFolders, [next.installDir, '/Users/you/Inbox'])
    assert.equal(settings.folders[0].root, path.join(next.dataRoot, 'sources'))
    const retail = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'retail-manifest.json'), 'utf8'))
    assert.equal(retail.files['Family.otf'].installedPath, path.join(next.installDir, 'Family.otf'))
    assert.equal(retail.files['Family.otf'].relativePath, 'Family.otf')
    const plan = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'plans', 'plan.json'), 'utf8'))
    assert.equal(plan.items[0].path, path.join(next.installDir, 'Family.otf'))
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

test('a symlinked legacy library is moved and a broken symlink stalls instead of seeding Cuttler', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const real = path.join(home, 'real-library')
  try {
    fs.mkdirSync(real, { recursive: true })
    fs.mkdirSync(path.dirname(legacyData), { recursive: true })
    fs.writeFileSync(path.join(real, 'catalog.json'), catalog([{ id: 'linked', installedPath: path.join(legacyData, 'Disabled', 'A.otf') }]))
    fs.symlinkSync(real, legacyData)
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, false)
    assert.equal(next.movedData, true)
    assert.equal(fs.lstatSync(next.dataRoot).isSymbolicLink(), true)
    assert.equal(fs.readlinkSync(next.dataRoot), real)
    const row = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8')).entries[0]
    assert.equal(row.id, 'linked')
    assert.equal(row.installedPath, path.join(next.dataRoot, 'Disabled', 'A.otf'))
    assert.equal(fs.existsSync(legacyData), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }

  const brokenHome = tempHome()
  const broken = path.join(brokenHome, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(path.dirname(broken), { recursive: true })
    fs.symlinkSync(path.join(brokenHome, 'missing-target'), broken)
    const next = migrateLegacyMacAppDirs(brokenHome)
    assert.equal(next.stalled, true)
    assert.equal(next.movedData, false)
    assert.equal(next.stalledDataDir, broken)
    assert.equal(fs.lstatSync(broken).isSymbolicLink(), true)
    assert.equal(fs.existsSync(path.join(brokenHome, 'Library/Application Support', APP_FOLDER_NAME)), false)
    const paths = buildPaths({ home: brokenHome, mac: true })
    assert.equal(paths.dataRoot, broken)
  } finally {
    fs.rmSync(brokenHome, { recursive: true, force: true })
  }
})

test('a stalled move keeps the running data root on the old library', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const previousStall = process.env[MIGRATION_STALL_ENV]
  const previousRoot = process.env[MIGRATION_DATA_ROOT_ENV]
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(nextData, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'old' }]))
    fs.writeFileSync(path.join(nextData, 'catalog.json'), catalog([{ id: 'new' }]))
    const first = migrateLegacyMacAppDirs(home)
    assert.equal(first.stalled, true)
    assert.equal(first.stalledDataDir, legacyData)
    const direct = buildPaths({ home, mac: true })
    assert.equal(direct.dataRoot, legacyData)
    assert.equal(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8').includes('"new"'), true)

    process.env[MIGRATION_STALL_ENV] = '1'
    process.env[MIGRATION_DATA_ROOT_ENV] = legacyData
    fs.writeFileSync(path.join(nextData, 'catalog.json'), '')
    fs.rmSync(nextData, { recursive: true, force: true })
    const adopted = buildPaths({ home, mac: true })
    assert.equal(adopted.dataRoot, legacyData)
    assert.equal(fs.existsSync(path.join(legacyData, 'catalog.json')), true)
    assert.equal(fs.existsSync(nextData), false)
  } finally {
    if (previousStall === undefined) delete process.env[MIGRATION_STALL_ENV]
    else process.env[MIGRATION_STALL_ENV] = previousStall
    if (previousRoot === undefined) delete process.env[MIGRATION_DATA_ROOT_ENV]
    else process.env[MIGRATION_DATA_ROOT_ENV] = previousRoot
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a crash after the folder rename finishes the catalog rewrite on the next launch', () => {
  const home = tempHome()
  const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const oldData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'catalog.json'), catalog([{ id: 'moved', installedPath: path.join(oldData, 'Disabled', 'A.otf') }]))
    fs.writeFileSync(
      path.join(dataRoot, 'mutation-journal.json'),
      JSON.stringify({ journals: [{ targets: [{ files: [{ snapshotPath: path.join(oldData, 'journal', 'snap.otf') }] }] }] }),
    )
    fs.writeFileSync(
      pending,
      JSON.stringify({
        version: 1,
        needsRewrite: true,
        dataRoot,
        stalledDataDir: null,
        dataFrom: PREVIOUS_APP_FOLDER_NAME,
        fontsFrom: null,
        replacements: [{ from: oldData, to: dataRoot }],
      }),
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.movedData, false)
    assert.equal(next.stalled, false)
    const row = JSON.parse(fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8')).entries[0]
    assert.equal(row.installedPath, path.join(dataRoot, 'Disabled', 'A.otf'))
    const journal = JSON.parse(fs.readFileSync(path.join(dataRoot, 'mutation-journal.json'), 'utf8'))
    assert.equal(journal.journals[0].targets[0].files[0].snapshotPath, path.join(dataRoot, 'journal', 'snap.otf'))
    assert.equal(fs.existsSync(pending), false)
    assert.equal(fs.existsSync(path.join(dataRoot, FOLDER_MIGRATION_FILE)), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a failed path rewrite leaves the pending marker for the next launch', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'keep', installedPath: path.join(legacyData, 'Disabled', 'A.otf') }]))
    assert.throws(() => migrateLegacyMacAppDirs(home, { failRewrite: true }), /rewrite failed/)
    assert.equal(fs.existsSync(pending), true)
    assert.equal(fs.existsSync(legacyData), false)
    assert.match(
      fs.readFileSync(path.join(home, 'Library/Application Support', APP_FOLDER_NAME, 'catalog.json'), 'utf8'),
      /Font Buttler/,
    )
    const pendingBody = JSON.parse(fs.readFileSync(pending, 'utf8'))
    assert.equal(pendingBody.needsRewrite, true)
    const finished = migrateLegacyMacAppDirs(home)
    assert.equal(finished.stalled, false)
    assert.equal(finished.movedData, false)
    const row = JSON.parse(fs.readFileSync(path.join(finished.dataRoot, 'catalog.json'), 'utf8')).entries[0]
    assert.equal(row.installedPath, path.join(finished.dataRoot, 'Disabled', 'A.otf'))
    assert.equal(fs.existsSync(pending), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a crash after the data rename rewrites the journal on the next launch', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const snapshot = path.join(legacyData, 'journal', 'job', 'macos-live.otf')
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(path.dirname(snapshot), { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(snapshot, 'original-bytes')
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    fs.writeFileSync(
      path.join(legacyData, 'catalog.json'),
      catalog([{ id: 'moved', installedPath: path.join(legacyInstall, 'Family.otf') }]),
    )
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({
        journals: [{ targets: [{ files: [{ snapshotPath: snapshot, originalPath: path.join(legacyInstall, 'Family.otf') }] }] }],
      }),
    )
    assert.equal(fs.existsSync(pending), false)
    assert.throws(() => migrateLegacyMacAppDirs(home, { crashAfterDataMove: true }), /killed after the data folder rename/)
    const dataRoot = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
    const movedSnapshot = path.join(dataRoot, 'journal', 'job', 'macos-live.otf')
    assert.equal(fs.existsSync(legacyData), false)
    assert.equal(fs.readFileSync(movedSnapshot, 'utf8'), 'original-bytes')
    assert.match(fs.readFileSync(path.join(dataRoot, 'mutation-journal.json'), 'utf8'), /Font Buttler/)
    assert.equal(fs.existsSync(pending), true)
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, false)
    const journal = JSON.parse(fs.readFileSync(path.join(dataRoot, 'mutation-journal.json'), 'utf8'))
    assert.equal(journal.journals[0].targets[0].files[0].snapshotPath, movedSnapshot)
    assert.equal(journal.journals[0].targets[0].files[0].originalPath, path.join(next.installDir, 'Family.otf'))
    const row = JSON.parse(fs.readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8')).entries[0]
    assert.equal(row.installedPath, path.join(next.installDir, 'Family.otf'))
    assert.equal(fs.readFileSync(movedSnapshot, 'utf8'), 'original-bytes')
    assert.equal(fs.existsSync(pending), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('unreadable user JSON does not stick the migration, and a bad plan is quarantined', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(path.join(legacyData, 'sources'), { recursive: true })
    fs.mkdirSync(path.join(legacyData, 'uploads'), { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'sources', 'note.json'), '{')
    fs.writeFileSync(path.join(legacyData, 'uploads', 'drop.json'), '{')
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'ok', installedPath: path.join(legacyData, 'Disabled', 'A.otf') }]))
    const moved = migrateLegacyMacAppDirs(home)
    assert.equal(moved.stalled, false)
    assert.equal(fs.existsSync(pending), false)
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(moved.dataRoot, 'catalog.json'), 'utf8')).entries[0].installedPath,
      path.join(moved.dataRoot, 'Disabled', 'A.otf'),
    )
    assert.equal(fs.readFileSync(path.join(moved.dataRoot, 'sources', 'note.json'), 'utf8'), '{')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }

  const retryHome = tempHome()
  const retryLegacy = path.join(retryHome, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const retryPending = path.join(retryHome, 'Library/Application Support', PENDING_MIGRATION_FILE)
  const plan = path.join(retryHome, 'Library/Application Support', APP_FOLDER_NAME, 'plans', 'bad.json')
  try {
    fs.mkdirSync(path.join(retryLegacy, 'plans'), { recursive: true })
    fs.writeFileSync(path.join(retryLegacy, 'catalog.json'), catalog([{ id: 'ok', installedPath: path.join(retryLegacy, 'Disabled', 'A.otf') }]))
    fs.writeFileSync(path.join(retryLegacy, 'plans', 'bad.json'), '{')
    const done = migrateLegacyMacAppDirs(retryHome)
    assert.equal(done.stalled, false)
    assert.equal(fs.existsSync(retryPending), false)
    assert.equal(launchAfterMigrationFailure(retryHome).blockWorker, false)
    assert.equal(fs.existsSync(plan), false)
    assert.equal(fs.readFileSync(`${plan}.unreadable`, 'utf8'), '{')
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(done.dataRoot, 'catalog.json'), 'utf8')).entries[0].installedPath,
      path.join(done.dataRoot, 'Disabled', 'A.otf'),
    )
    const again = migrateLegacyMacAppDirs(retryHome)
    assert.equal(again.stalled, false)
  } finally {
    fs.rmSync(retryHome, { recursive: true, force: true })
  }
})

test('a data stall that later succeeds still rewrites paths into Cuttler', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const snapshot = path.join(legacyData, 'journal', 'job', 'macos-live.otf')
  try {
    fs.mkdirSync(path.dirname(snapshot), { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(snapshot, 'original-bytes')
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    fs.writeFileSync(
      path.join(legacyData, 'catalog.json'),
      catalog([{ id: 'later', sourcePath: path.join(legacyData, 'sources', 'Family.otf') }]),
    )
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({ journals: [{ targets: [{ files: [{ snapshotPath: snapshot }] }] }] }),
    )
    const blocked = migrateLegacyMacAppDirs(home, {
      renameSync(from, to) {
        if (from.endsWith(`${path.sep}${PREVIOUS_APP_FOLDER_NAME}`) && from.includes(`${path.sep}Application Support${path.sep}`)) {
          const error = new Error('transient') as NodeJS.ErrnoException
          error.code = 'EIO'
          throw error
        }
        fs.renameSync(from, to)
      },
    })
    assert.equal(blocked.stalled, true)
    assert.equal(blocked.movedData, false)
    assert.equal(blocked.movedFonts, true)
    assert.equal(fs.existsSync(path.join(legacyData, 'catalog.json')), true)
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, false)
    assert.equal(next.movedData, true)
    const row = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8')).entries[0]
    assert.equal(row.sourcePath, path.join(next.dataRoot, 'sources', 'Family.otf'))
    const journal = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'mutation-journal.json'), 'utf8'))
    const movedSnapshot = path.join(next.dataRoot, 'journal', 'job', 'macos-live.otf')
    assert.equal(journal.journals[0].targets[0].files[0].snapshotPath, movedSnapshot)
    assert.equal(fs.readFileSync(movedSnapshot, 'utf8'), 'original-bytes')
    assert.equal(fs.existsSync(path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('truncated non-essential JSON does not block the journal rewrite', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const snapshot = path.join(legacyData, 'journal', 'job', 'macos-live.otf')
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(path.dirname(snapshot), { recursive: true })
    fs.writeFileSync(snapshot, 'original-bytes')
    fs.writeFileSync(path.join(legacyData, 'finder-sync-agent.json'), '{')
    fs.writeFileSync(path.join(legacyData, 'system-cache.json'), '{')
    fs.writeFileSync(
      path.join(legacyData, 'catalog.json'),
      catalog([{ id: 'ok', disabledPath: path.join(legacyData, 'Disabled', 'A.otf') }]),
    )
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({ journals: [{ targets: [{ files: [{ snapshotPath: snapshot }] }] }] }),
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, false)
    const movedSnapshot = path.join(next.dataRoot, 'journal', 'job', 'macos-live.otf')
    const journal = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'mutation-journal.json'), 'utf8'))
    assert.equal(journal.journals[0].targets[0].files[0].snapshotPath, movedSnapshot)
    assert.equal(fs.readFileSync(movedSnapshot, 'utf8'), 'original-bytes')
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'finder-sync-agent.json'), 'utf8'), '{')
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'system-cache.json'), 'utf8'), '{')
    assert.equal(fs.existsSync(pending), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a bad journal blocks opening the library and a stall throw stays on the old folder', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const nextData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.mkdirSync(nextData, { recursive: true })
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    fs.writeFileSync(path.join(nextData, 'settings.json'), '{}')
    fs.writeFileSync(path.join(nextData, 'catalog.json'), catalog([{ id: 'occupied', installedPath: path.join(legacyInstall, 'Family.otf') }]))
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'kept', installedPath: path.join(legacyInstall, 'Family.otf') }]))
    fs.writeFileSync(path.join(legacyData, 'mutation-journal.json'), '{')
    assert.throws(() => migrateLegacyMacAppDirs(home), /Could not read/)
    const failure = launchAfterMigrationFailure(home)
    assert.equal(failure.blockWorker, true)
    assert.equal(failure.stalled, true)
    assert.equal(failure.stalledDataDir, legacyData)
    assert.equal(fs.existsSync(pending), true)
    assert.equal(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8').includes('occupied'), true)
    assert.match(fs.readFileSync(path.join(nextData, 'catalog.json'), 'utf8'), /Font Buttler/)
    assert.equal(fs.readFileSync(path.join(legacyData, 'mutation-journal.json'), 'utf8'), '{')
    assert.equal(fs.existsSync(path.join(home, 'Library/Fonts', APP_FOLDER_NAME, 'Family.otf')), true)
    assert.equal(fs.existsSync(legacyInstall), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a handled launch does not migrate again after a fonts-only stall or a throw', () => {
  const home = tempHome()
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const previous = process.env[MIGRATION_HANDLED_ENV]
  try {
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    process.env[MIGRATION_HANDLED_ENV] = '1'
    const paths = buildPaths({ home, mac: true })
    assert.equal(paths.dataRoot, path.join(home, 'Library/Application Support', APP_FOLDER_NAME))
    assert.equal(fs.existsSync(path.join(legacyInstall, 'Family.otf')), true)
    assert.equal(fs.existsSync(path.join(home, 'Library/Fonts', APP_FOLDER_NAME)), false)
  } finally {
    if (previous === undefined) delete process.env[MIGRATION_HANDLED_ENV]
    else process.env[MIGRATION_HANDLED_ENV] = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
})

function ownerHooks(
  alive: (pid: number) => boolean,
  held: boolean | null | (() => boolean | null) = true,
  waitMs = 0,
  extra: Record<string, unknown> = {},
) {
  return {
    ownerWaitMs: waitMs,
    ownerPollMs: 1,
    sleepSync() {},
    isAlive: alive,
    cookieHeld: () => (typeof held === 'function' ? held() : held),
    ...extra,
  }
}

function placeSymlinkCookie(dir: string) {
  const cookie = path.join(dir, 'SingletonCookie')
  fs.rmSync(cookie, { force: true })
  fs.symlinkSync(`chromium-token-${process.pid}`, cookie)
}

function placeLegacyLock(dir: string, pid: number) {
  fs.mkdirSync(dir, { recursive: true })
  fs.symlinkSync(`fixture-host-${pid}`, path.join(dir, 'SingletonLock'))
  fs.writeFileSync(path.join(dir, 'SingletonCookie'), '')
  fs.writeFileSync(path.join(dir, 'SingletonSocket'), '')
}

test('a live legacy SingletonLock blocks the move and does not seed Cuttler', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const oneT = path.join(home, 'Library/Application Support', LEGACY_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const cuttlerData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  const cuttlerFonts = path.join(home, 'Library/Fonts', APP_FOLDER_NAME)
  try {
    placeLegacyLock(legacyData, 4321)
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'kept', installedPath: path.join(legacyInstall, 'Family.otf') }]))
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    const hooks = ownerHooks(() => true, true)
    const blocked = migrateLegacyMacAppDirs(home, hooks)
    assert.equal(blocked.blockedByOwner, true)
    assert.equal(blocked.ownerPid, 4321)
    assert.equal(blocked.ownerDataDir, legacyData)
    assert.equal(blocked.movedData, false)
    assert.equal(blocked.movedFonts, false)
    assert.match(legacyOwnerBlockMessage(blocked), /Quit the previous Cuttler \(Font Buttler\) first/)
    assert.match(legacyOwnerBlockMessage(blocked), /Application Support/)
    assert.equal(fs.existsSync(path.join(legacyData, 'catalog.json')), true)
    assert.equal(fs.existsSync(path.join(legacyInstall, 'Family.otf')), true)
    assert.equal(fs.existsSync(cuttlerData), false)
    assert.equal(fs.existsSync(cuttlerFonts), false)
    assert.throws(() => buildPaths({ home, mac: true, migrationHooks: hooks }), /Quit the previous Cuttler/)
    assert.equal(fs.existsSync(cuttlerData), false)
    assert.equal(fs.existsSync(path.join(legacyData, 'catalog.json')), true)

    fs.rmSync(path.join(legacyData, 'SingletonLock'))
    placeLegacyLock(oneT, 77)
    fs.writeFileSync(path.join(oneT, 'catalog.json'), catalog([{ id: 'one-t' }]))
    const oneTBlocked = migrateLegacyMacAppDirs(home, ownerHooks(() => true, true))
    assert.equal(oneTBlocked.blockedByOwner, true)
    assert.equal(oneTBlocked.ownerDataDir, oneT)
    assert.equal(fs.existsSync(cuttlerData), false)
    assert.equal(legacyLibraryHasRunningOwner(oneT, { selfPid: 77, isAlive: () => true, cookieHeld: () => true }), false)
    assert.equal(legacyLibraryHasRunningOwner(oneT, { selfPid: 1, isAlive: () => true, cookieHeld: () => true }), true)
    assert.equal(readSingletonLockPid(path.join(oneT, 'SingletonLock')), 77)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('migration proceeds once the legacy owner has exited', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  try {
    placeLegacyLock(legacyData, 5150)
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'after', installedPath: path.join(legacyInstall, 'Family.otf') }]))
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    let checks = 0
    const next = migrateLegacyMacAppDirs(
      home,
      ownerHooks(() => {
        checks += 1
        return checks < 2
      }, true, 1_000),
    )
    assert.ok(checks >= 2)
    assert.equal(next.blockedByOwner, false)
    assert.equal(next.movedData, true)
    assert.equal(next.movedFonts, true)
    assert.equal(fs.existsSync(legacyData), false)
    assert.equal(fs.existsSync(path.join(next.dataRoot, 'catalog.json')), true)
    assert.equal(fs.existsSync(path.join(next.installDir, 'Family.otf')), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a stale or recycled legacy lock does not defer the move', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  try {
    placeLegacyLock(legacyData, 999001)
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'stale', installedPath: path.join(legacyData, 'Disabled', 'A.otf') }]))
    const stale = migrateLegacyMacAppDirs(home, ownerHooks(() => false, true))
    assert.equal(stale.blockedByOwner, false)
    assert.equal(stale.movedData, true)
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(stale.dataRoot, 'catalog.json'), 'utf8')).entries[0].installedPath,
      path.join(stale.dataRoot, 'Disabled', 'A.otf'),
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }

  const recycledHome = tempHome()
  const recycled = path.join(recycledHome, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  try {
    placeLegacyLock(recycled, 999002)
    fs.writeFileSync(path.join(recycled, 'catalog.json'), catalog([{ id: 'recycled' }]))
    const next = migrateLegacyMacAppDirs(recycledHome, ownerHooks(() => true, false))
    assert.equal(next.blockedByOwner, false)
    assert.equal(next.movedData, true)
    assert.equal(fs.existsSync(path.join(next.dataRoot, 'catalog.json')), true)
    assert.equal(legacyLibraryHasRunningOwner(recycled, { isAlive: () => true, cookieHeld: () => false }), false)
  } finally {
    fs.rmSync(recycledHome, { recursive: true, force: true })
  }
})

function holdSingletonCookie(cookiePath: string): ChildProcess {
  return spawn(
    'perl',
    ['-e', 'use Fcntl qw(:flock); open my $fh, ">>", $ARGV[0] or die $!; flock($fh, LOCK_EX) or die $!; sleep 30;', cookiePath],
    { stdio: 'ignore' },
  )
}

async function waitFor(check: () => boolean, label: string) {
  const started = Date.now()
  while (Date.now() - started < 2_000) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(label)
}

test('a held SingletonCookie is a live owner and a free cookie is not', async () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  let child: ChildProcess | null = null
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    const cookie = path.join(legacyData, 'SingletonCookie')
    fs.writeFileSync(cookie, '')
    child = holdSingletonCookie(cookie)
    await waitFor(() => singletonCookieHeld(cookie) === true, 'cookie flock was not taken')
    fs.symlinkSync(`fixture-host-${child.pid}`, path.join(legacyData, 'SingletonLock'))
    assert.equal(readSingletonLockPid(path.join(legacyData, 'SingletonLock')), child.pid)
    assert.equal(legacyLibraryHasRunningOwner(legacyData), true)
    child.kill('SIGKILL')
    await new Promise((resolve) => child?.once('exit', resolve))
    child = null
    assert.equal(legacyLibraryHasRunningOwner(legacyData, { isAlive: () => true }), false)
    assert.equal(singletonCookieHeld(cookie), false)
  } finally {
    child?.kill('SIGKILL')
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a truncated catalog is recovered from catalog.json.bak and both copies are rewritten', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    const installed = path.join(legacyData, 'Disabled', 'A.otf')
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), '{')
    fs.writeFileSync(
      path.join(legacyData, 'catalog.json.bak'),
      catalog([{ id: 'recovered', installedPath: installed, sourcePath: '/Users/you/Fonts/A.otf' }]),
    )
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({ journals: [{ targets: [{ files: [{ snapshotPath: path.join(legacyData, 'journal', 'snap.otf') }] }] }] }),
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.blockedByOwner, false)
    assert.equal(next.stalled, false)
    assert.equal(launchAfterMigrationFailure(home).blockWorker, false)
    assert.equal(fs.existsSync(pending), false)
    const primary = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8'))
    const backup = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json.bak'), 'utf8'))
    assert.equal(primary.entries[0].id, 'recovered')
    assert.equal(primary.entries[0].installedPath, path.join(next.dataRoot, 'Disabled', 'A.otf'))
    assert.equal(primary.entries[0].sourcePath, '/Users/you/Fonts/A.otf')
    assert.equal(backup.entries[0].installedPath, path.join(next.dataRoot, 'Disabled', 'A.otf'))
    const journal = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'mutation-journal.json'), 'utf8'))
    assert.equal(journal.journals[0].targets[0].files[0].snapshotPath, path.join(next.dataRoot, 'journal', 'snap.otf'))
    const again = migrateLegacyMacAppDirs(home)
    assert.equal(again.stalled, false)
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(again.dataRoot, 'catalog.json'), 'utf8')).entries[0].installedPath,
      path.join(again.dataRoot, 'Disabled', 'A.otf'),
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('an unusable catalog with no usable backup blocks launch and keeps the pending marker', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), '{')
    fs.writeFileSync(path.join(legacyData, 'catalog.json.bak'), '{')
    assert.throws(() => migrateLegacyMacAppDirs(home), /Could not read/)
    assert.equal(fs.existsSync(pending), true)
    assert.equal(launchAfterMigrationFailure(home).blockWorker, true)
    assert.throws(() => migrateLegacyMacAppDirs(home), /Could not read/)
    assert.equal(fs.existsSync(pending), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }

  const missingBak = tempHome()
  const missingLegacy = path.join(missingBak, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(missingLegacy, { recursive: true })
    fs.writeFileSync(path.join(missingLegacy, 'catalog.json'), '{')
    assert.throws(() => migrateLegacyMacAppDirs(missingBak), /Could not read/)
    assert.equal(fs.existsSync(path.join(missingBak, 'Library/Application Support', PENDING_MIGRATION_FILE)), true)
    assert.equal(launchAfterMigrationFailure(missingBak).blockWorker, true)
  } finally {
    fs.rmSync(missingBak, { recursive: true, force: true })
  }
})

test('truncated settings, operations, and plans are quarantined without blocking the worker', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const pending = path.join(home, 'Library/Application Support', PENDING_MIGRATION_FILE)
  const snapshot = path.join(legacyData, 'journal', 'job', 'snap.otf')
  try {
    fs.mkdirSync(path.dirname(snapshot), { recursive: true })
    fs.mkdirSync(path.join(legacyData, 'plans'), { recursive: true })
    fs.writeFileSync(snapshot, 'original-bytes')
    fs.writeFileSync(path.join(legacyData, 'settings.json'), '{')
    fs.writeFileSync(path.join(legacyData, 'operations.json'), '{')
    fs.writeFileSync(path.join(legacyData, 'plans', 'later.json'), '{')
    fs.writeFileSync(path.join(legacyData, 'finder-sync-agent.json'), '{')
    fs.writeFileSync(path.join(legacyData, 'system-cache.json'), '{')
    fs.writeFileSync(
      path.join(legacyData, 'catalog.json'),
      catalog([{ id: 'ok', disabledPath: path.join(legacyData, 'Disabled', 'A.otf') }]),
    )
    fs.writeFileSync(
      path.join(legacyData, 'mutation-journal.json'),
      JSON.stringify({ journals: [{ targets: [{ files: [{ snapshotPath: snapshot }] }] }] }),
    )
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.stalled, false)
    assert.equal(launchAfterMigrationFailure(home).blockWorker, false)
    assert.equal(fs.existsSync(pending), false)
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'catalog.json'), 'utf8')).entries[0].disabledPath,
      path.join(next.dataRoot, 'Disabled', 'A.otf'),
    )
    const journal = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'mutation-journal.json'), 'utf8'))
    assert.equal(journal.journals[0].targets[0].files[0].snapshotPath, path.join(next.dataRoot, 'journal', 'job', 'snap.otf'))
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'journal', 'job', 'snap.otf'), 'utf8'), 'original-bytes')
    for (const name of ['settings.json', 'operations.json', 'plans/later.json']) {
      assert.equal(fs.existsSync(path.join(next.dataRoot, name)), false)
      assert.equal(fs.readFileSync(path.join(next.dataRoot, `${name}.unreadable`), 'utf8'), '{')
    }
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'finder-sync-agent.json'), 'utf8'), '{')
    assert.equal(fs.readFileSync(path.join(next.dataRoot, 'system-cache.json'), 'utf8'), '{')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('duplicates and unlinked sources keep their paths after the library moves', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const incoming = path.join(legacyData, 'uploads', 'New.otf')
  const unlinked = path.join(legacyData, 'sources', 'Old.otf')
  const skippedIncoming = path.join(legacyData, 'uploads', 'Skipped.otf')
  try {
    fs.mkdirSync(path.dirname(incoming), { recursive: true })
    fs.mkdirSync(path.dirname(unlinked), { recursive: true })
    fs.writeFileSync(incoming, 'font-bytes')
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'dup' }]))
    const notifyKey = `${incoming}|fp-incoming|fp-installed`
    fs.writeFileSync(
      path.join(legacyData, 'duplicates.json'),
      JSON.stringify({
        version: 1,
        items: [{
          id: 'd1',
          path: incoming,
          notifyKey,
          fingerprint: 'fp-incoming',
          conflictingEntryIds: ['installed'],
          createdAt: 1,
          updatedAt: 1,
        }],
      }),
    )
    fs.writeFileSync(
      path.join(legacyData, 'skipped-duplicates.json'),
      JSON.stringify({ version: 1, keys: [`${skippedIncoming}|fp-skip|fp-old`] }),
    )
    fs.writeFileSync(
      path.join(legacyData, 'unlinked-sources.json'),
      JSON.stringify({ version: 1, paths: [unlinked, '/Users/you/Inbox/Other.otf'] }),
    )
    const next = migrateLegacyMacAppDirs(home)
    const movedIncoming = path.join(next.dataRoot, 'uploads', 'New.otf')
    const duplicates = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'duplicates.json'), 'utf8'))
    assert.equal(duplicates.items[0].path, movedIncoming)
    assert.equal(duplicates.items[0].notifyKey, `${movedIncoming}|fp-incoming|fp-installed`)
    assert.equal(fs.readFileSync(movedIncoming, 'utf8'), 'font-bytes')
    const skipped = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'skipped-duplicates.json'), 'utf8'))
    assert.equal(skipped.keys[0], `${path.join(next.dataRoot, 'uploads', 'Skipped.otf')}|fp-skip|fp-old`)
    const unlinkedFile = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'unlinked-sources.json'), 'utf8'))
    assert.deepEqual(unlinkedFile.paths, [path.join(next.dataRoot, 'sources', 'Old.otf'), '/Users/you/Inbox/Other.otf'])
    const kept = pruneStaleDuplicates({ dataRoot: next.dataRoot } as AppPaths)
    assert.equal(kept.length, 1)
    assert.equal(kept[0].path, movedIncoming)
    assert.equal(kept[0].notifyKey, `${movedIncoming}|fp-incoming|fp-installed`)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a truncated unlinked list is recovered from its backup and an unusable list stays resettable', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const external = '/Users/you/Inbox/Kept.otf'
  const internal = path.join(legacyData, 'sources', 'Kept.otf')
  try {
    fs.mkdirSync(legacyData, { recursive: true })
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'kept' }]))
    fs.writeFileSync(path.join(legacyData, 'unlinked-sources.json'), '{')
    fs.writeFileSync(
      path.join(legacyData, 'unlinked-sources.json.bak'),
      JSON.stringify({ version: 1, paths: [external, internal] }),
    )
    const next = migrateLegacyMacAppDirs(home)
    const movedInternal = path.join(next.dataRoot, 'sources', 'Kept.otf')
    const primary = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'unlinked-sources.json'), 'utf8'))
    const backup = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'unlinked-sources.json.bak'), 'utf8'))
    assert.deepEqual(primary.paths, [external, movedInternal])
    assert.deepEqual(backup.paths, [external, movedInternal])
    assert.equal(fs.existsSync(path.join(next.dataRoot, 'unlinked-sources.json.unreadable')), false)
    const library = { dataRoot: next.dataRoot } as AppPaths
    assert.equal(isUnlinkedSource(library, external), true)
    assert.equal(isUnlinkedSource(library, movedInternal), true)
    const again = migrateLegacyMacAppDirs(home)
    assert.equal(again.stalled, false)
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(again.dataRoot, 'unlinked-sources.json'), 'utf8')).paths,
      [external, movedInternal],
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }

  const entriesHome = tempHome()
  const entriesLegacy = path.join(entriesHome, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(entriesLegacy, { recursive: true })
    fs.writeFileSync(path.join(entriesLegacy, 'catalog.json'), catalog([{ id: 'entries' }]))
    fs.writeFileSync(path.join(entriesLegacy, 'unlinked-sources.json'), '{')
    fs.writeFileSync(
      path.join(entriesLegacy, 'unlinked-sources.json.bak'),
      JSON.stringify({
        version: 1,
        entries: [{ path: path.join(entriesLegacy, 'sources', 'FromEntries.otf'), fingerprint: 'abc' }],
      }),
    )
    const next = migrateLegacyMacAppDirs(entriesHome)
    const recovered = JSON.parse(fs.readFileSync(path.join(next.dataRoot, 'unlinked-sources.json'), 'utf8'))
    assert.equal(recovered.entries[0].path, path.join(next.dataRoot, 'sources', 'FromEntries.otf'))
    assert.equal(recovered.entries[0].fingerprint, 'abc')
  } finally {
    fs.rmSync(entriesHome, { recursive: true, force: true })
  }

  const brokenHome = tempHome()
  const brokenLegacy = path.join(brokenHome, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  try {
    fs.mkdirSync(brokenLegacy, { recursive: true })
    fs.writeFileSync(path.join(brokenLegacy, 'catalog.json'), catalog([{ id: 'broken' }]))
    fs.writeFileSync(path.join(brokenLegacy, 'unlinked-sources.json'), '{')
    const next = migrateLegacyMacAppDirs(brokenHome)
    const primaryPath = path.join(next.dataRoot, 'unlinked-sources.json')
    assert.equal(fs.readFileSync(primaryPath, 'utf8'), '{')
    assert.equal(fs.existsSync(`${primaryPath}.unreadable`), false)
    assert.equal(fs.existsSync(`${primaryPath}.bak`), false)
    const library = { dataRoot: next.dataRoot } as AppPaths
    assert.equal(isUnlinkedSource(library, '/Users/you/Inbox/Any.otf'), true)
    const retried = migrateLegacyMacAppDirs(brokenHome)
    assert.equal(fs.readFileSync(path.join(retried.dataRoot, 'unlinked-sources.json'), 'utf8'), '{')
    assert.equal(isUnlinkedSource({ dataRoot: retried.dataRoot } as AppPaths, '/Users/you/Inbox/Any.otf'), true)
    assert.equal(recoverUnlinkedSources(library), true)
  } finally {
    fs.rmSync(brokenHome, { recursive: true, force: true })
  }
})

test('a symlink cookie does not treat a recycled pid as the legacy owner', async () => {
  assert.equal(isLegacyAppExecutable('/Applications/Cuttler.app/Contents/MacOS/Cuttler'), true)
  assert.equal(isLegacyAppExecutable('/Applications/Cuttler.app/Contents/MacOS/Cuttler Helper'), false)
  assert.equal(isLegacyAppExecutable('/Applications/Font Buttler.app/Contents/MacOS/Font Buttler'), true)
  assert.equal(isLegacyAppExecutable('/Applications/Font Butler.app/Contents/MacOS/Font Butler'), true)
  assert.equal(isLegacyAppExecutable('Electron'), true)
  assert.equal(isLegacyAppExecutable('/usr/bin/sleep'), false)

  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const child = spawn('sleep', ['30'], { stdio: 'ignore' })
  try {
    placeLegacyLock(legacyData, child.pid ?? 0)
    placeSymlinkCookie(legacyData)
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'recycled' }]))
    await waitFor(() => {
      try {
        return fs.statSync(`/proc/${child.pid}/exe`).isFile()
      } catch {
        return false
      }
    }, 'unrelated process did not start')
    assert.equal(fs.lstatSync(path.join(legacyData, 'SingletonCookie')).isSymbolicLink(), true)
    assert.equal(legacyLibraryHasRunningOwner(legacyData), false)
    const next = migrateLegacyMacAppDirs(home)
    assert.equal(next.blockedByOwner, false)
    assert.equal(next.runningInstanceDataDir, null)
    assert.equal(next.movedData, true)
    assert.equal(fs.existsSync(path.join(next.dataRoot, 'catalog.json')), true)
  } finally {
    child.kill('SIGKILL')
    fs.rmSync(home, { recursive: true, force: true })
  }

  const owned = tempHome()
  const ownedLegacy = path.join(owned, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  try {
    placeLegacyLock(ownedLegacy, 2468)
    placeSymlinkCookie(ownedLegacy)
    fs.writeFileSync(path.join(ownedLegacy, 'catalog.json'), catalog([{ id: 'old-app' }]))
    let slept = 0
    const hooks = ownerHooks(() => true, null, 40, {
      isSameExecutable: () => false,
      isAppProcess: () => true,
      sleepSync() {
        slept += 1
      },
    })
    const blocked = migrateLegacyMacAppDirs(owned, hooks)
    assert.equal(blocked.blockedByOwner, true)
    assert.equal(blocked.runningInstanceDataDir, null)
    assert.equal(blocked.movedData, false)
    assert.ok(slept > 0)
    assert.equal(legacyLibraryHasRunningOwner(ownedLegacy, hooks), true)
    assert.equal(fs.existsSync(path.join(owned, 'Library/Application Support', APP_FOLDER_NAME)), false)
    assert.equal(fs.existsSync(path.join(ownedLegacy, 'catalog.json')), true)
  } finally {
    fs.rmSync(owned, { recursive: true, force: true })
  }
})

test('an unreadable symlink-cookie identity does not block the move', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const cuttlerData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  try {
    placeLegacyLock(legacyData, 4242)
    placeSymlinkCookie(legacyData)
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'unreadable-owner' }]))
    let slept = 0
    const hooks = ownerHooks(() => true, null, 10_000, {
      isSameExecutable: () => null,
      isAppProcess: () => null,
      sleepSync() {
        slept += 1
      },
    })
    assert.equal(fs.lstatSync(path.join(legacyData, 'SingletonCookie')).isSymbolicLink(), true)
    assert.equal(legacyLibraryHasRunningOwner(legacyData, hooks), false)
    const next = migrateLegacyMacAppDirs(home, hooks)
    assert.equal(slept, 0)
    assert.equal(next.blockedByOwner, false)
    assert.equal(next.runningInstanceDataDir, null)
    assert.equal(next.movedData, true)
    assert.equal(fs.existsSync(legacyData), false)
    assert.equal(fs.existsSync(path.join(cuttlerData, 'catalog.json')), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a same-executable lock in the legacy folder hands off instead of blocking', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  const legacyInstall = path.join(home, 'Library/Fonts', PREVIOUS_APP_FOLDER_NAME)
  const cuttlerData = path.join(home, 'Library/Application Support', APP_FOLDER_NAME)
  try {
    placeLegacyLock(legacyData, 5151)
    placeSymlinkCookie(legacyData)
    fs.mkdirSync(legacyInstall, { recursive: true })
    fs.writeFileSync(path.join(legacyInstall, 'Family.otf'), 'font')
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'stalled-app' }]))
    let slept = 0
    const hooks = ownerHooks(() => true, null, 10_000, {
      isSameExecutable: () => true,
      isAppProcess: () => true,
      sleepSync() {
        slept += 1
      },
    })
    const next = migrateLegacyMacAppDirs(home, hooks)
    assert.equal(next.blockedByOwner, false)
    assert.equal(next.runningInstanceDataDir, legacyData)
    assert.equal(next.movedData, false)
    assert.equal(next.movedFonts, false)
    assert.equal(slept, 0)
    assert.equal(legacyLibraryHasRunningOwner(legacyData, hooks), false)
    assert.equal(fs.existsSync(path.join(legacyData, 'catalog.json')), true)
    assert.equal(fs.existsSync(path.join(legacyInstall, 'Family.otf')), true)
    assert.equal(fs.existsSync(cuttlerData), false)
    const paths = buildPaths({ home, mac: true, migrationHooks: hooks })
    assert.equal(paths.dataRoot, legacyData)
    assert.equal(fs.existsSync(cuttlerData), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a regular cookie whose flock check cannot run still blocks a live pid', () => {
  const home = tempHome()
  const legacyData = path.join(home, 'Library/Application Support', PREVIOUS_APP_FOLDER_NAME)
  try {
    placeLegacyLock(legacyData, 9191)
    fs.writeFileSync(path.join(legacyData, 'catalog.json'), catalog([{ id: 'unknown-flock' }]))
    const hooks = ownerHooks(() => true, null, 0, {
      isSameExecutable: () => false,
      isAppProcess: () => false,
    })
    const blocked = migrateLegacyMacAppDirs(home, hooks)
    assert.equal(blocked.blockedByOwner, true)
    assert.equal(blocked.movedData, false)
    assert.equal(fs.lstatSync(path.join(legacyData, 'SingletonCookie')).isSymbolicLink(), false)
    assert.equal(fs.existsSync(path.join(home, 'Library/Application Support', APP_FOLDER_NAME)), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})


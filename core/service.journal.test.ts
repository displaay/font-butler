import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { findById, loadCatalog, saveCatalog } from './catalog.ts'
import { fingerprintFile } from './fingerprint.ts'
import { uniquePathFromOriginal } from './install.ts'
import {
  beginJournal,
  loadIncompleteJournals,
} from './journal.ts'
import { noopFontNative } from './native.ts'
import { loadOperations } from './operations.ts'
import { isFontFile } from './parse.ts'
import { FontButlerService } from './service.ts'
import { withService, writeTestFont } from './test-util.ts'

function liveFonts(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((file) => {
      try {
        return fs.statSync(file).isFile() && isFontFile(file)
      } catch {
        return false
      }
    })
}

function recoveryOps(paths: Parameters<typeof loadOperations>[0]) {
  return loadOperations(paths).filter((item) => item.action === 'recover-journal')
}

async function waitForJournal(paths: Parameters<typeof loadIncompleteJournals>[0]): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline && loadIncompleteJournals(paths).length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('replace writes a journal before dest mutation and clears it on success', async () => {
  let release: (() => void) | undefined
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  await withService(
    async (service, paths) => {
      await service.init()
      const source = path.join(paths.dataRoot, 'JournalFace.ttf')
      writeTestFont(source, 'JournalFace', 'JournalFace-Regular')
      const imported = await service.importPaths([source])
      const installed = await service.install(imported.entries[0]!.id)
      assert.equal(loadIncompleteJournals(paths).length, 0)
      writeTestFont(source, 'JournalFace', 'JournalFace-Regular', { version: 'Version 2.000' })

      const pending = service.install(installed.id, undefined, { replace: true })
      await waitForJournal(paths)
      const open = loadIncompleteJournals(paths)
      assert.equal(open.length, 1)
      assert.equal(open[0]!.kind, 'replace')
      assert.equal(open[0]!.phase, 'mutating')
      assert.ok(open[0]!.targets[0]!.files.some((file) => file.role === 'macos-live'))
      release?.()
      await pending
      assert.equal(loadIncompleteJournals(paths).length, 0)
    },
    {
      native: noopFontNative({
        async setFontEnabled(filePath, enabled) {
          if (enabled && path.basename(filePath).includes('JournalFace')) {
            await hold
          }
          return { ok: true, native: false }
        },
      }),
    },
  )
})

test('startup reconcile rolls back a crash mid-replace and restores working bytes', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'KeepFace.ttf')
    writeTestFont(source, 'KeepFace', 'KeepFace-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const dest = installed.installedPath!
    const original = fs.readFileSync(dest)
    const catalogEntry = findById(loadCatalog(paths), installed.id)!

    beginJournal(paths, { kind: 'replace', entries: [catalogEntry] })
    writeTestFont(dest, 'KeepFace', 'KeepFace-Regular', { version: 'Version 2.000' })
    assert.notDeepEqual(fs.readFileSync(dest), original)
    assert.equal(loadIncompleteJournals(paths).length, 1)

    service.dispose()
    const restarted = new FontButlerService(paths)
    await restarted.init()
    try {
      assert.equal(loadIncompleteJournals(paths).length, 0)
      assert.deepEqual(fs.readFileSync(dest), original)
      const latest = restarted.listCatalog().find((entry) => entry.id === installed.id)
      assert.equal(latest?.status, 'installed')
      const recovered = recoveryOps(paths)
      assert.equal(recovered.length, 1)
      assert.equal(recovered[0]!.trigger, 'startup')
      assert.equal(recovered[0]!.outcome, 'succeeded')
      assert.equal(recovered[0]!.undoable, false)
    } finally {
      restarted.dispose()
    }
  })
})

test('startup reconcile undoes a crash mid-park and keeps the working install', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'ParkFace.ttf')
    writeTestFont(source, 'ParkFace', 'ParkFace-Regular')
    const imported = await service.importPaths([source])
    const installed = await service.install(imported.entries[0]!.id)
    const dest = installed.installedPath!
    const original = fs.readFileSync(dest)
    const catalogEntry = findById(loadCatalog(paths), installed.id)!
    beginJournal(paths, { kind: 'park', entries: [catalogEntry] })

    const vault = uniquePathFromOriginal(paths.disabledDir, dest)
    fs.mkdirSync(paths.disabledDir, { recursive: true })
    fs.renameSync(dest, vault)
    assert.equal(fs.existsSync(dest), false)
    assert.equal(fs.existsSync(vault), true)
    assert.equal(findById(loadCatalog(paths), installed.id)?.status, 'installed')

    service.dispose()
    const restarted = new FontButlerService(paths)
    await restarted.init()
    try {
      assert.equal(loadIncompleteJournals(paths).length, 0)
      assert.equal(fs.existsSync(dest), true)
      assert.deepEqual(fs.readFileSync(dest), original)
      assert.equal(fs.existsSync(vault), false)
      const latest = restarted.listCatalog().find((entry) => entry.id === installed.id)
      assert.equal(latest?.status, 'installed')
      assert.equal(liveFonts(paths.installDir).length, 1)
      assert.equal(recoveryOps(paths)[0]?.action, 'recover-journal')
    } finally {
      restarted.dispose()
    }
  })
})

test('startup reconcile restores the previous working copy after a crash mid-switch', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    const wip = path.join(paths.dataRoot, 'WIP.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    writeTestFont(wip, 'Release', 'Release-Regular', { version: 'Version 2.000' })
    const first = (await service.importPaths([release])).entries[0]!
    const installed = await service.install(first.id)
    const dest = installed.installedPath!
    const releaseBytes = fs.readFileSync(dest)
    const plan = service.planImport([wip])
    await service.applyPlan(plan.id, { [plan.items[0]!.id]: 'add-inactive' })
    const inactive = service.listCatalog().find((entry) => entry.id !== first.id)!

    const catalogA = findById(loadCatalog(paths), first.id)!
    const catalogB = findById(loadCatalog(paths), inactive.id)!
    beginJournal(paths, { kind: 'switch', entries: [catalogA, catalogB] })

    const vault = uniquePathFromOriginal(paths.disabledDir, dest)
    fs.mkdirSync(paths.disabledDir, { recursive: true })
    fs.renameSync(dest, vault)
    const catalog = loadCatalog(paths)
    const parked = findById(catalog, first.id)!
    parked.status = 'deactivated'
    parked.disabledPath = vault
    saveCatalog(paths, catalog)
    const incomingDest = path.join(paths.installDir, path.basename(wip))
    fs.copyFileSync(wip, incomingDest)

    service.dispose()
    const restarted = new FontButlerService(paths)
    await restarted.init()
    try {
      assert.equal(loadIncompleteJournals(paths).length, 0)
      assert.equal(fs.existsSync(dest), true)
      assert.deepEqual(fs.readFileSync(dest), releaseBytes)
      assert.equal(fs.existsSync(vault), false)
      const after = restarted.listCatalog()
      assert.equal(after.find((entry) => entry.id === first.id)?.status, 'installed')
      assert.equal(after.find((entry) => entry.id === inactive.id)?.status, 'uninstalled')
      assert.equal(liveFonts(paths.installDir).length, 1)
      assert.equal(fingerprintFile(liveFonts(paths.installDir)[0]!), fingerprintFile(release))
      assert.ok(recoveryOps(paths).some((item) => item.trigger === 'startup'))
    } finally {
      restarted.dispose()
    }
  })
})

test('successful install, park, and switch leave no incomplete journals', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    const wip = path.join(paths.dataRoot, 'WIP.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    writeTestFont(wip, 'Release', 'Release-Regular', { version: 'Version 2.000' })
    const first = (await service.importPaths([release])).entries[0]!
    await service.install(first.id)
    assert.equal(loadIncompleteJournals(paths).length, 0)

    const plan = service.planImport([wip])
    await service.applyPlan(plan.id, { [plan.items[0]!.id]: 'add-inactive' })
    const inactive = service.listCatalog().find((entry) => entry.id !== first.id)!
    await service.switchTo(inactive.id)
    assert.equal(loadIncompleteJournals(paths).length, 0)

    await service.deactivate(inactive.id)
    assert.equal(loadIncompleteJournals(paths).length, 0)
    assert.equal(service.listCatalog().find((entry) => entry.id === inactive.id)?.status, 'deactivated')
  })
})

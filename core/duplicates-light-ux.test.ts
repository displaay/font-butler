import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createWatchFolder } from './folders.ts'
import { fingerprintFile } from './fingerprint.ts'
import { classifyImportFile } from './planner.ts'
import { withService, writeTestFont } from './test-util.ts'
import type { CatalogEntry, CatalogFile } from './types.ts'

test('classifyImportFile treats installations[].fingerprint as sameBytes', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const source = path.join(paths.dataRoot, 'Release.ttf')
    const rename = path.join(paths.dataRoot, 'Release-Renamed.ttf')
    writeTestFont(source, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    fs.copyFileSync(source, rename)
    const fingerprint = fingerprintFile(source)

    const entry: CatalogEntry = {
      id: 'adopted-1',
      sourcePath: path.join(paths.installDir, 'FontBase', 'Release.ttf'),
      sourceMtimeMs: 1,
      sourceSize: 1,
      sourcePresent: false,
      // Intentionally omit top-level fingerprints — adopt often leaves only copy stamps.
      status: 'installed',
      installedPath: path.join(paths.installDir, 'FontBase', 'Release.ttf'),
      faces: [
        {
          familyName: 'Release',
          styleName: 'Regular',
          fullName: 'Release Regular',
          postscriptName: 'Release-Regular',
          isVariable: false,
          instanceCount: 0,
          instanceNames: [],
          weight: 400,
          italic: false,
        },
      ],
      format: 'ttf',
      addedAt: 1,
      updatedAt: 1,
      installations: [
        {
          destinationId: 'macos',
          path: path.join(paths.installDir, 'FontBase', 'Release.ttf'),
          fingerprint,
          verification: 'file-present',
        },
      ],
    }
    const catalog: CatalogFile = { version: 1, entries: [entry] }
    const item = classifyImportFile(rename, catalog, { paths })
    assert.equal(item.classification, 'identical')
    assert.equal(item.entryId, entry.id)
  })
})

test('Skip remembers notifyKey so watch rescans do not recreate the warning', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    const first = (await service.importPaths([release])).entries[0]!
    await service.install(first.id)

    const inbox = path.join(paths.dataRoot, 'inbox')
    fs.mkdirSync(inbox, { recursive: true })
    const duplicate = path.join(inbox, 'WIP.ttf')
    writeTestFont(duplicate, 'Release', 'Release-Regular', { version: 'Version 2.000' })
    await service.updateSettings({
      onboardingCompleted: true,
      folders: [createWatchFolder(inbox, { policy: 'install-new-and-updates', watching: true })],
    })
    const warning = service.listDuplicates()[0]
    assert.ok(warning)

    await service.resolveDuplicate(warning.id, 'skip')
    assert.equal(service.listDuplicates().length, 0)

    // Re-trigger watch import of the same inbox.
    await service.updateSettings({
      folders: [
        createWatchFolder(inbox, {
          id: service.getSettings().folders[0]?.id,
          policy: 'install-new-and-updates',
          watching: true,
        }),
      ],
    })
    assert.equal(service.listDuplicates().length, 0)
  })
})

test('batch dismiss same-byte matches and skip selected', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    const first = (await service.importPaths([release])).entries[0]!
    await service.install(first.id)
    const installed = service.listCatalog().find((entry) => entry.id === first.id)!
    const fingerprint = installed.installedFingerprint ?? fingerprintFile(installed.installedPath!)

    const inbox = path.join(paths.dataRoot, 'inbox')
    fs.mkdirSync(inbox, { recursive: true })
    const sameBytes = path.join(inbox, 'ReleaseCopy.ttf')
    fs.copyFileSync(release, sameBytes)
    const different = path.join(inbox, 'ReleaseV2.ttf')
    writeTestFont(different, 'Release', 'Release-Regular', { version: 'Version 2.000' })

    // Seed two warnings directly so same-byte detection is exercised even after
    // classifyImportFile collapses identical bytes before watch upsert.
    const { upsertDuplicateWarning, duplicateNotifyKey } = await import('./duplicates.ts')
    const sameWarning = upsertDuplicateWarning(paths, {
      path: sameBytes,
      fingerprint,
      familyName: 'Release',
      format: 'ttf',
      conflictingEntryIds: [first.id],
      activeEntryId: first.id,
      notifyKey: duplicateNotifyKey(sameBytes, fingerprint, [fingerprint]),
    }).warning!
    const diffFp = fingerprintFile(different)
    const diffWarning = upsertDuplicateWarning(paths, {
      path: different,
      fingerprint: diffFp,
      familyName: 'Release',
      format: 'ttf',
      conflictingEntryIds: [first.id],
      activeEntryId: first.id,
      notifyKey: duplicateNotifyKey(different, diffFp, [fingerprint]),
    }).warning!
    assert.equal(service.listDuplicates().length, 2)

    const dismissed = await service.resolveDuplicates([sameWarning.id, diffWarning.id], 'skip', {
      sameBytesOnly: true,
    })
    assert.equal(dismissed.resolved, 1)
    const remaining = service.listDuplicates()
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0]!.id, diffWarning.id)

    const skipped = await service.resolveDuplicates([diffWarning.id], 'skip')
    assert.equal(skipped.resolved, 1)
    assert.equal(service.listDuplicates().length, 0)
  })
})

test('batch replace active same bytes retargets source without touching version conflicts', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    const first = (await service.importPaths([release])).entries[0]!
    await service.install(first.id)
    const installed = service.listCatalog().find((entry) => entry.id === first.id)!
    const fingerprint = installed.installedFingerprint ?? fingerprintFile(installed.installedPath!)

    const inbox = path.join(paths.dataRoot, 'inbox')
    fs.mkdirSync(inbox, { recursive: true })
    const watched = path.join(inbox, 'Release-from-watch.ttf')
    fs.copyFileSync(release, watched)
    const conflict = path.join(inbox, 'Release-v2.ttf')
    writeTestFont(conflict, 'Release', 'Release-Regular', { version: 'Version 2.000' })

    const { upsertDuplicateWarning, duplicateNotifyKey } = await import('./duplicates.ts')
    const sameWarning = upsertDuplicateWarning(paths, {
      path: watched,
      fingerprint,
      familyName: 'Release',
      format: 'ttf',
      conflictingEntryIds: [first.id],
      activeEntryId: first.id,
      notifyKey: duplicateNotifyKey(watched, fingerprint, [fingerprint]),
    }).warning!
    const conflictFp = fingerprintFile(conflict)
    const conflictWarning = upsertDuplicateWarning(paths, {
      path: conflict,
      fingerprint: conflictFp,
      familyName: 'Release',
      format: 'ttf',
      conflictingEntryIds: [first.id],
      activeEntryId: first.id,
      notifyKey: duplicateNotifyKey(conflict, conflictFp, [fingerprint]),
    }).warning!

    const result = await service.resolveDuplicates([sameWarning.id, conflictWarning.id], 'replace', {
      sameBytesOnly: true,
    })
    assert.equal(result.resolved, 1)
    const latest = service.listCatalog().find((entry) => entry.id === first.id)!
    assert.equal(path.resolve(latest.sourcePath), path.resolve(watched))
    assert.equal(service.listDuplicates().some((item) => item.id === conflictWarning.id), true)
  })
})

test('durable skip file is written under data root', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const release = path.join(paths.dataRoot, 'Release.ttf')
    writeTestFont(release, 'Release', 'Release-Regular', { version: 'Version 1.000' })
    const first = (await service.importPaths([release])).entries[0]!
    await service.install(first.id)
    const inbox = path.join(paths.dataRoot, 'inbox')
    fs.mkdirSync(inbox, { recursive: true })
    const duplicate = path.join(inbox, 'WIP.ttf')
    writeTestFont(duplicate, 'Release', 'Release-Regular', { version: 'Version 2.000' })
    await service.updateSettings({
      onboardingCompleted: true,
      folders: [createWatchFolder(inbox, { policy: 'install-new-and-updates', watching: true })],
    })
    const warning = service.listDuplicates()[0]!
    await service.resolveDuplicate(warning.id, 'skip')
    const skippedPath = path.join(paths.dataRoot, 'skipped-duplicates.json')
    assert.equal(fs.existsSync(skippedPath), true)
    const parsed = JSON.parse(fs.readFileSync(skippedPath, 'utf8')) as { keys: string[] }
    assert.ok(parsed.keys.includes(warning.notifyKey))
  })
})

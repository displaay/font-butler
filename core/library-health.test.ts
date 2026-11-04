import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { faceIdentityKey, loadCatalog, saveCatalog } from './catalog.ts'
import { fingerprintFile } from './fingerprint.ts'
import { entryFormat } from './formats.ts'
import { assertParkKeepsVerifiedGood, scanLibraryHealth } from './library-health.ts'
import { inspectSourceAvailability } from './state.ts'
import { tempPaths, withService, writeTestFont } from './test-util.ts'
import type { CatalogEntry } from './types.ts'

function face() {
  return {
    familyName: 'Health',
    styleName: 'Regular',
    fullName: 'Health Regular',
    postscriptName: 'Health-Regular',
    isVariable: false,
    instanceCount: 1,
    instanceNames: [],
    weight: 400,
    italic: false,
  }
}

function makeEntry(
  id: string,
  sourcePath: string,
  installedPath: string | undefined,
  format: 'ttf' | 'otf' = 'ttf',
): CatalogEntry {
  return {
    id,
    sourcePath,
    sourceMtimeMs: 1,
    sourceSize: fs.existsSync(sourcePath) ? fs.statSync(sourcePath).size : 1,
    sourcePresent: fs.existsSync(sourcePath),
    sourceFingerprint: fs.existsSync(sourcePath) ? fingerprintFile(sourcePath) : undefined,
    installedFingerprint: installedPath && fs.existsSync(installedPath) ? fingerprintFile(installedPath) : undefined,
    status: installedPath ? 'installed' : 'source-missing',
    ...(installedPath
      ? {
          installedPath,
          installations: [
            {
              destinationId: 'macos' as const,
              path: installedPath,
              fingerprint: fingerprintFile(installedPath),
              verification: 'file-present' as const,
            },
          ],
        }
      : {}),
    faces: [face()],
    format,
    addedAt: 1,
    updatedAt: 1,
  }
}

test('installed-twice fix keeps the keeper and parks the extra, source untouched', async () => {
  await withService(async (service, paths) => {
    const dirA = path.join(paths.dataRoot, 'a')
    const dirB = path.join(paths.dataRoot, 'b')
    const sourceA = path.join(dirA, 'Health.ttf')
    const sourceB = path.join(dirB, 'Health.ttf')
    const installedA = path.join(paths.installDir, 'a', 'Health.ttf')
    const installedB = path.join(paths.installDir, 'b', 'Health.ttf')
    writeTestFont(sourceA, 'Health', 'Health-Regular')
    fs.mkdirSync(path.dirname(sourceB), { recursive: true })
    fs.copyFileSync(sourceA, sourceB)
    fs.mkdirSync(path.dirname(installedA), { recursive: true })
    fs.mkdirSync(path.dirname(installedB), { recursive: true })
    fs.copyFileSync(sourceA, installedA)
    fs.copyFileSync(sourceA, installedB)
    const keeper = makeEntry('entry-a', sourceA, installedA)
    const extra = makeEntry('entry-b', sourceB, installedB)
    saveCatalog(paths, { version: 1, entries: [keeper, extra] })

    const report = service.scanLibraryHealth()
    const finding = report.findings.find((item) => item.group === 'installed-twice')
    assert.ok(finding, JSON.stringify(report.findings))
    assert.equal(finding.keeperEntryId, 'entry-a')
    assert.equal(finding.reportOnly, false)
    assert.deepEqual(
      finding.copies.filter((copy) => copy.role === 'keeper').map((copy) => copy.entryId),
      ['entry-a'],
    )
    assert.deepEqual(finding.actions, [
      { kind: 'park-extra', entryId: 'entry-b', label: 'Park extra copy' },
    ])

    const result = await service.applyLibraryHealthFix({ action: 'park-extra', entryId: 'entry-b' })
    assert.equal(fs.existsSync(installedA), true, 'keeper stays installed')
    assert.equal(fs.existsSync(installedB), false, 'extra leaves the live destination')
    assert.equal(fs.existsSync(sourceB), true, 'extra source file is never deleted')
    const after = loadCatalog(paths)
    const parked = after.entries.find((entry) => entry.id === 'entry-b')
    assert.equal(parked?.status, 'deactivated')
    assert.ok(parked?.disabledPath && fs.existsSync(parked.disabledPath), 'extra is parked in the vault, not deleted')
    assert.equal(result.report.findings.some((item) => item.group === 'installed-twice'), false)
  })
})

test('alt-format pairs are not grouped as installed-twice and never auto-parked', async () => {
  await withService(async (service, paths) => {
    const sourceTtf = path.join(paths.dataRoot, 'ttf', 'Health.ttf')
    const sourceOtf = path.join(paths.dataRoot, 'otf', 'Health.otf')
    const installedTtf = path.join(paths.installDir, 'Health.ttf')
    const installedOtf = path.join(paths.installDir, 'Health.otf')
    writeTestFont(sourceTtf, 'Health', 'Health-Regular', { format: 'ttf' })
    writeTestFont(sourceOtf, 'Health', 'Health-Regular', { format: 'otf' })
    fs.mkdirSync(paths.installDir, { recursive: true })
    fs.copyFileSync(sourceTtf, installedTtf)
    fs.copyFileSync(sourceOtf, installedOtf)
    saveCatalog(paths, {
      version: 1,
      entries: [
        makeEntry('entry-ttf', sourceTtf, installedTtf, 'ttf'),
        makeEntry('entry-otf', sourceOtf, installedOtf, 'otf'),
      ],
    })
    const report = service.scanLibraryHealth()
    assert.equal(report.counts['installed-twice'], 0)
    assert.equal(
      report.findings.some((finding) => finding.actions.some((action) => action.kind === 'park-extra')),
      false,
    )
  })
})

test('missing source offers relink, refuses entry removal as the only copy, and relink fixes it', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'external', 'Health.ttf')
    const moved = path.join(paths.dataRoot, 'moved', 'Health.ttf')
    writeTestFont(source, 'Health', 'Health-Regular')
    fs.mkdirSync(path.dirname(moved), { recursive: true })
    fs.copyFileSync(source, moved)
    const entry = makeEntry('entry-missing', source, undefined)
    fs.rmSync(source)
    entry.sourcePresent = false
    saveCatalog(paths, { version: 1, entries: [entry] })

    const report = service.scanLibraryHealth()
    const finding = report.findings.find((item) => item.group === 'missing-source')
    assert.ok(finding)
    assert.equal(finding.reportOnly, false)
    assert.ok(finding.actions.some((action) => action.kind === 'relink'))
    assert.equal(
      finding.actions.some((action) => action.kind === 'remove-entry'),
      false,
      'entry removal is not offered when it is the only copy',
    )
    await assert.rejects(
      () => service.applyLibraryHealthFix({ action: 'remove-entry', entryId: 'entry-missing' }),
      /no longer available/,
    )

    const result = await service.applyLibraryHealthFix({
      action: 'relink',
      entryId: 'entry-missing',
      candidatePath: moved,
    })
    assert.equal(result.entries[0]?.sourcePath, moved)
    assert.equal(
      result.report.findings.some((item) => item.group === 'missing-source' && item.entryIds.includes('entry-missing')),
      false,
    )
  })
})

test('offline-volume missing source is report-only with no destructive fix', async () => {
  const paths = tempPaths('font-butler-health-offline-')
  try {
    const source = '/mnt/font-butler-no-such-volume/Health.ttf'
    if (inspectSourceAvailability(source, { linked: true, external: true }) !== 'offline') {
      // Platforms without a mounted /mnt cannot express the offline branch.
      return
    }
    const entry = makeEntry('entry-offline', source, undefined)
    const report = scanLibraryHealth([entry], paths)
    const finding = report.findings.find((item) => item.group === 'missing-source')
    assert.ok(finding)
    assert.equal(finding.reportOnly, true)
    assert.deepEqual(finding.actions, [])
    assert.match(finding.reportReason ?? '', /offline/i)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('damaged file is report-only when it is the only copy and is left in place', async () => {
  await withService(async (service, paths) => {
    const source = path.join(paths.dataRoot, 'external', 'Health.ttf')
    writeTestFont(source, 'Health', 'Health-Regular')
    const entry = makeEntry('entry-damaged', source, undefined)
    entry.status = 'uninstalled'
    const bytes = fs.readFileSync(source)
    fs.writeFileSync(source, bytes.subarray(0, Math.floor(bytes.length / 3)))
    saveCatalog(paths, { version: 1, entries: [entry] })

    const report = service.scanLibraryHealth()
    const finding = report.findings.find((item) => item.group === 'damaged')
    assert.ok(finding, JSON.stringify(report.findings))
    assert.equal(finding.reportOnly, true)
    assert.deepEqual(finding.actions, [])
    await assert.rejects(
      () => service.applyLibraryHealthFix({ action: 'park-damaged', entryId: 'entry-damaged' }),
      /no longer available/,
    )
    assert.equal(fs.existsSync(source), true, 'the only (damaged) copy is never deleted')
  })
})

test('damaged live copy is parked only when a verified-good copy exists elsewhere', async () => {
  await withService(async (service, paths) => {
    const goodSource = path.join(paths.dataRoot, 'good', 'Health.ttf')
    const badSource = path.join(paths.dataRoot, 'bad', 'Health.ttf')
    const goodInstalled = path.join(paths.installDir, 'good', 'Health.ttf')
    const badInstalled = path.join(paths.installDir, 'bad', 'Health.ttf')
    writeTestFont(goodSource, 'Health', 'Health-Regular')
    fs.mkdirSync(path.dirname(badSource), { recursive: true })
    fs.copyFileSync(goodSource, badSource)
    fs.mkdirSync(path.dirname(goodInstalled), { recursive: true })
    fs.mkdirSync(path.dirname(badInstalled), { recursive: true })
    fs.copyFileSync(goodSource, goodInstalled)
    fs.copyFileSync(goodSource, badInstalled)
    const good = makeEntry('entry-good', goodSource, goodInstalled)
    const bad = makeEntry('entry-bad', badSource, badInstalled)
    const bytes = fs.readFileSync(badInstalled)
    fs.writeFileSync(badInstalled, bytes.subarray(0, Math.floor(bytes.length / 3)))
    saveCatalog(paths, { version: 1, entries: [good, bad] })

    const report = service.scanLibraryHealth()
    const finding = report.findings.find(
      (item) => item.group === 'damaged' && item.entryIds.includes('entry-bad'),
    )
    assert.ok(finding, JSON.stringify(report.findings))
    assert.equal(finding.reportOnly, false)
    assert.ok(finding.actions.some((action) => action.kind === 'park-damaged'))

    await service.applyLibraryHealthFix({ action: 'park-damaged', entryId: 'entry-bad' })
    assert.equal(fs.existsSync(badInstalled), false)
    assert.equal(fs.existsSync(goodInstalled), true, 'verified-good copy stays installed')
    const parked = loadCatalog(paths).entries.find((entry) => entry.id === 'entry-bad')
    assert.ok(parked?.disabledPath && fs.existsSync(parked.disabledPath), 'damaged copy is parked, not deleted')
    assert.equal(fs.existsSync(badSource), true, 'source file is never deleted')
  })
})

test('fix refuses to park the last verified-good copy', async () => {
  await withService(async (service, paths) => {
    const sourceA = path.join(paths.dataRoot, 'a', 'Health.ttf')
    const sourceB = path.join(paths.dataRoot, 'b', 'Health.ttf')
    const installedA = path.join(paths.installDir, 'a', 'Health.ttf')
    const installedB = path.join(paths.installDir, 'b', 'Health.ttf')
    writeTestFont(sourceA, 'Health', 'Health-Regular')
    fs.mkdirSync(path.dirname(sourceB), { recursive: true })
    fs.copyFileSync(sourceA, sourceB)
    fs.mkdirSync(path.dirname(installedA), { recursive: true })
    fs.mkdirSync(path.dirname(installedB), { recursive: true })
    fs.copyFileSync(sourceA, installedA)
    fs.copyFileSync(sourceA, installedB)
    const keeper = makeEntry('entry-a', sourceA, installedA)
    const extra = makeEntry('entry-b', sourceB, installedB)
    saveCatalog(paths, { version: 1, entries: [keeper, extra] })

    // The keeper itself is never offered as a park-extra, and applying it is refused.
    await assert.rejects(
      () => service.applyLibraryHealthFix({ action: 'park-extra', entryId: 'entry-a' }),
      /no longer available/,
    )
    assert.equal(fs.existsSync(installedA), true)

    // Direct guard: with every other copy tampered, entry-a is the last good copy.
    writeTestFont(sourceB, 'Health', 'Health-Regular', { version: 'Version 2.000' })
    fs.copyFileSync(sourceB, installedB)
    const entries = loadCatalog(paths).entries
    const key = faceIdentityKey(keeper.faces, entryFormat(keeper))
    assert.throws(
      () => assertParkKeepsVerifiedGood(entries, paths, key, 'entry-a'),
      /no verified-good copy/,
    )
    assert.throws(
      () => assertParkKeepsVerifiedGood(entries, paths, key, 'entry-a', 'entry-a'),
      /keeper/,
    )
    assert.equal(fs.existsSync(installedA), true, 'keeper remains installed after refused fixes')
  })
})

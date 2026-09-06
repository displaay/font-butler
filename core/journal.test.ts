import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import {
  beginJournal,
  completeJournal,
  loadIncompleteJournals,
  withMutationJournal,
} from './journal.ts'
import { journalPath } from './paths.ts'
import { tempPaths } from './test-util.ts'
import type { CatalogEntry } from './types.ts'

function dummyEntry(id: string, family: string): CatalogEntry {
  return {
    id,
    sourcePath: `/tmp/${family}.ttf`,
    sourceMtimeMs: 1,
    sourceSize: 1,
    status: 'installed',
    faces: [
      {
        familyName: family,
        styleName: 'Regular',
        fullName: `${family} Regular`,
        postscriptName: `${family}-Regular`,
        isVariable: false,
        instanceCount: 1,
        instanceNames: [],
        weight: 400,
        italic: false,
      },
    ],
    format: 'ttf',
    addedAt: 1,
    updatedAt: 1,
  }
}

test('beginJournal persists a prepared record and completeJournal removes it', () => {
  const paths = tempPaths('journal-helper-')
  try {
    const entry = dummyEntry('entry-1', 'JournalFace')
    const journal = beginJournal(paths, { kind: 'install', entries: [entry] })
    assert.equal(journal.phase, 'prepared')
    const loaded = loadIncompleteJournals(paths)
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0]!.id, journal.id)
    assert.equal(loaded[0]!.kind, 'install')
    assert.equal(loaded[0]!.targets[0]!.entryId, 'entry-1')
    completeJournal(paths, journal.id)
    assert.equal(loadIncompleteJournals(paths).length, 0)
    assert.equal(fs.existsSync(journalPath(paths)), false)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('withMutationJournal skips nested journals and clears on success or throw', async () => {
  const paths = tempPaths('journal-nested-')
  try {
    const entry = dummyEntry('entry-1', 'NestedFace')
    await withMutationJournal(paths, { kind: 'switch', entries: [entry] }, async () => {
      await withMutationJournal(paths, { kind: 'park', entries: [entry] }, async () => {
        const open = loadIncompleteJournals(paths)
        assert.equal(open.length, 1)
        assert.equal(open[0]!.kind, 'switch')
      })
      assert.equal(loadIncompleteJournals(paths).length, 1)
    })
    assert.equal(loadIncompleteJournals(paths).length, 0)

    await assert.rejects(
      () =>
        withMutationJournal(paths, { kind: 'park', entries: [entry] }, async () => {
          throw new Error('in-process failure')
        }),
      /in-process failure/,
    )
    assert.equal(loadIncompleteJournals(paths).length, 0)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('beginJournal snapshots existing dest bytes before mutation', () => {
  const paths = tempPaths('journal-snap-')
  try {
    const dest = path.join(paths.installDir, 'Snap.ttf')
    fs.mkdirSync(paths.installDir, { recursive: true })
    fs.writeFileSync(dest, 'original-bytes')
    const entry = dummyEntry('entry-1', 'Snap')
    entry.installedPath = dest
    const journal = beginJournal(paths, { kind: 'replace', entries: [entry] })
    const live = journal.targets[0]!.files.find((file) => file.role === 'macos-live')
    assert.ok(live)
    assert.equal(fs.readFileSync(live.snapshotPath, 'utf8'), 'original-bytes')
    fs.writeFileSync(dest, 'replaced-bytes')
    assert.equal(fs.readFileSync(live.snapshotPath, 'utf8'), 'original-bytes')
    completeJournal(paths, journal.id)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

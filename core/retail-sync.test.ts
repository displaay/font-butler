import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildPaths } from './paths.ts'
import {
  countPendingDrift,
  diffRetailManifest,
  forgetRetailFile,
  isSafeRelativePath,
  loadRetailManifest,
  resolveRetailInstallPath,
  resolveRetailPath,
  saveRetailManifest,
  type RetailStatFile,
} from './retail-sync.ts'
import type {
  RetailFile,
  RetailLocalFile,
  RetailLocalManifest,
  RetailManifest,
} from '../shared/retail.ts'

function remoteFile(overrides: Partial<RetailFile> = {}): RetailFile {
  return {
    key: 'Reckless/rev-1/RecklessVF.otf',
    relativePath: 'Reckless/RecklessVF.otf',
    size: 100,
    etag: 'etag-1',
    uploaded: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function manifest(files: RetailFile[], overrides: Partial<RetailManifest> = {}): RetailManifest {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    collections: [
      { glyphsFile: 'Reckless', revisionId: 'rev-1', lastRegeneratedAt: null, files },
    ],
    skipped: [],
    ...overrides,
  }
}

function localFile(overrides: Partial<RetailLocalFile> = {}): RetailLocalFile {
  return {
    key: 'Reckless/rev-1/RecklessVF.otf',
    relativePath: 'Reckless/RecklessVF.otf',
    size: 100,
    etag: 'etag-1',
    glyphsFile: 'Reckless',
    revisionId: 'rev-1',
    syncedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function local(files: RetailLocalFile[]): RetailLocalManifest {
  return {
    version: 1,
    syncedAt: '2026-01-01T00:00:00.000Z',
    files: Object.fromEntries(files.map((file) => [file.relativePath, file])),
  }
}

const onDisk = (size: number): RetailStatFile => () => ({ exists: true, size })
const absent: RetailStatFile = () => ({ exists: false, size: 0 })

test('a file that was never synced is added', () => {
  const drift = diffRetailManifest(manifest([remoteFile()]), local([]), absent)
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'added')
  assert.equal(drift[0].relativePath, 'Reckless/RecklessVF.otf')
})

test('an identical file produces no drift', () => {
  const drift = diffRetailManifest(manifest([remoteFile()]), local([localFile()]), onDisk(100))
  assert.deepEqual(drift, [])
})

test('a different etag at the same size counts as changed', () => {
  const drift = diffRetailManifest(
    manifest([remoteFile({ etag: 'etag-2' })]),
    local([localFile()]),
    onDisk(100),
  )
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'changed')
})

test('a different size at the same etag counts as changed', () => {
  // Multipart etags are not content hashes, so size is checked alongside rather than trusted away.
  const drift = diffRetailManifest(
    manifest([remoteFile({ size: 200 })]),
    local([localFile()]),
    onDisk(100),
  )
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'changed')
})

test('a synced file that is gone from disk is missing-locally', () => {
  const drift = diffRetailManifest(manifest([remoteFile()]), local([localFile()]), absent)
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'missing-locally')
})

test('a synced file whose on-disk size drifted is corrupt-locally', () => {
  const drift = diffRetailManifest(manifest([remoteFile()]), local([localFile()]), onDisk(64))
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'corrupt-locally')
})

test('a file that vanished from the manifest is removed', () => {
  const drift = diffRetailManifest(manifest([]), local([localFile()]), onDisk(100))
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'removed')
  assert.equal(drift[0].remote, undefined)
})

test('a revision bump changes the file in place and orphans nothing', () => {
  // The regression test for the layout decision: relativePath carries no revision id, so new bytes under
  // a new revision land on the same local path. Putting the revision in the path would turn every
  // regeneration into removed+added, orphaning files and creating duplicate catalog entries.
  const drift = diffRetailManifest(
    {
      generatedAt: '2026-02-01T00:00:00.000Z',
      collections: [
        {
          glyphsFile: 'Reckless',
          revisionId: 'rev-2',
          lastRegeneratedAt: '2026-02-01T00:00:00.000Z',
          files: [
            remoteFile({ key: 'Reckless/rev-2/RecklessVF.otf', etag: 'etag-2', size: 120 }),
          ],
        },
      ],
      skipped: [],
    },
    local([localFile()]),
    onDisk(100),
  )
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'changed')
  assert.equal(drift[0].relativePath, 'Reckless/RecklessVF.otf')
  assert.equal(drift.filter((item) => item.kind === 'added').length, 0)
  assert.equal(drift.filter((item) => item.kind === 'removed').length, 0)
})

test('drift is sorted and only syncable kinds are counted as pending', () => {
  const drift = diffRetailManifest(
    manifest([
      remoteFile({ relativePath: 'Reckless/B.otf', key: 'Reckless/rev-1/B.otf' }),
      remoteFile({ relativePath: 'Reckless/A.otf', key: 'Reckless/rev-1/A.otf' }),
    ]),
    local([localFile({ relativePath: 'Reckless/Z-gone.otf' })]),
    absent,
  )
  assert.deepEqual(
    drift.map((item) => item.relativePath),
    ['Reckless/A.otf', 'Reckless/B.otf', 'Reckless/Z-gone.otf'],
  )
  // Two added plus one removed; removed is reported but never downloaded or deleted.
  assert.equal(countPendingDrift(drift), 2)
})

test('isSafeRelativePath rejects traversal, absolute and Windows-hostile segments', () => {
  for (const good of ['Reckless/RecklessVF.otf', 'A/B/c.ttf', 'Vinila/Vinila-Regular.otf']) {
    assert.equal(isSafeRelativePath(good), true, good)
  }
  for (const bad of [
    '',
    '   ',
    '../escape.otf',
    'a/../../b.otf',
    '/absolute.otf',
    'a\\b.otf',
    'C:/Windows/x.otf',
    'a//b.otf',
    './a.otf',
    'a/./b.otf',
    'trailing./x.otf',
    'trailing /x.otf',
    ' leading/x.otf',
    'nul\0byte.otf',
  ]) {
    assert.equal(isSafeRelativePath(bad), false, bad)
  }
})

test('resolveRetailPath keeps every result under the root', () => {
  const root = path.resolve('/tmp/retail')
  const inside = resolveRetailPath(root, 'Reckless/RecklessVF.otf')
  assert.ok(inside)
  assert.ok(inside.startsWith(`${root}${path.sep}`))
  assert.equal(resolveRetailPath(root, '../outside.otf'), null)
  assert.equal(resolveRetailPath(root, '/etc/passwd'), null)
})

test('resolveRetailInstallPath flattens to the Fonts folder basename', () => {
  const fonts = path.resolve('/tmp/Fonts')
  assert.equal(resolveRetailInstallPath(fonts, 'Reckless/RecklessVF.otf'), path.join(fonts, 'RecklessVF.otf'))
  assert.equal(resolveRetailInstallPath(fonts, '../escape.otf'), null)
})

test('two families that flatten to the same Fonts basename conflict', () => {
  const drift = diffRetailManifest(
    {
      generatedAt: '2026-01-01T00:00:00.000Z',
      collections: [
        {
          glyphsFile: 'Reckless',
          revisionId: 'rev-1',
          lastRegeneratedAt: null,
          files: [remoteFile({ key: 'Reckless/rev-1/X.otf', relativePath: 'Reckless/X.otf', etag: 'e1', size: 10 })],
        },
        {
          glyphsFile: 'Vinila',
          revisionId: 'rev-1',
          lastRegeneratedAt: null,
          files: [remoteFile({ key: 'Vinila/rev-1/X.otf', relativePath: 'Vinila/X.otf', etag: 'e2', size: 20 })],
        },
      ],
      skipped: [],
    },
    local([]),
    absent,
  )
  assert.equal(drift.filter((item) => item.kind === 'added').length, 1)
  assert.equal(drift.filter((item) => item.kind === 'conflict').length, 1)
})

test('two collections claiming one path conflict instead of fighting over the file', () => {
  // Without this, each check flips the file between the two versions and `pending` never reaches 0.
  const drift = diffRetailManifest(
    {
      generatedAt: '2026-01-01T00:00:00.000Z',
      collections: [
        {
          glyphsFile: 'Reckless A',
          revisionId: 'rev-1',
          lastRegeneratedAt: null,
          files: [remoteFile({ key: 'A/rev-1/X.otf', relativePath: 'Reckless/X.otf', etag: 'e1', size: 10 })],
        },
        {
          glyphsFile: 'Reckless B',
          revisionId: 'rev-1',
          lastRegeneratedAt: null,
          files: [remoteFile({ key: 'B/rev-1/X.otf', relativePath: 'Reckless/X.otf', etag: 'e2', size: 20 })],
        },
      ],
      skipped: [],
    },
    local([]),
    absent,
  )
  assert.equal(drift.filter((item) => item.kind === 'added').length, 1)
  assert.equal(drift.filter((item) => item.kind === 'conflict').length, 1)
  assert.equal(countPendingDrift(drift), 1)
})

test('a case-only difference is a conflict, because APFS sees one file', () => {
  const drift = diffRetailManifest(
    {
      generatedAt: '2026-01-01T00:00:00.000Z',
      collections: [
        {
          glyphsFile: 'A',
          revisionId: 'r',
          lastRegeneratedAt: null,
          files: [remoteFile({ key: 'A/r/X.otf', relativePath: 'Reckless/X.otf' })],
        },
        {
          glyphsFile: 'B',
          revisionId: 'r',
          lastRegeneratedAt: null,
          files: [remoteFile({ key: 'B/r/x.otf', relativePath: 'Reckless/x.otf', etag: 'e2' })],
        },
      ],
      skipped: [],
    },
    local([]),
    absent,
  )
  assert.equal(drift.filter((item) => item.kind === 'conflict').length, 1)
})

test('an unsafe remote path is refused loudly, not dropped silently', () => {
  const drift = diffRetailManifest(
    manifest([remoteFile({ relativePath: '../escape.otf' })]),
    local([]),
    absent,
  )
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'refused')
  // A refused file is not syncable, so it must not inflate the pending count either.
  assert.equal(countPendingDrift(drift), 0)
})

test('a corrupted local manifest entry degrades to a resync instead of crashing', () => {
  const corrupted = {
    version: 1 as const,
    syncedAt: null,
    files: { 'Reckless/RecklessVF.otf': null },
  }
  const drift = diffRetailManifest(
    manifest([remoteFile()]),
    corrupted as unknown as RetailLocalManifest,
    absent,
  )
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'added')
})

test('a local entry whose key disagrees with its relativePath is discarded', () => {
  const mismatched = {
    version: 1 as const,
    syncedAt: null,
    files: { 'KEY.otf': localFile({ relativePath: 'OTHER.otf' }) },
  }
  const drift = diffRetailManifest(
    { generatedAt: 'x', collections: [], skipped: [] },
    mismatched as unknown as RetailLocalManifest,
    absent,
  )
  // Neither reported as removed nor kept around to be re-downloaded forever.
  assert.deepEqual(drift, [])
})

test('a remote path named after an Object prototype key is treated as new', () => {
  const drift = diffRetailManifest(
    manifest([remoteFile({ relativePath: 'toString' })]),
    local([]),
    absent,
  )
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'added')
})

test('a remote entry with a non-numeric size is refused rather than always changed', () => {
  const drift = diffRetailManifest(
    manifest([remoteFile({ size: '100' as unknown as number })]),
    local([localFile()]),
    onDisk(100),
  )
  assert.equal(drift.length, 1)
  assert.equal(drift[0].kind, 'refused')
})

test('forgetRetailFile drops a key from the local manifest', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-retail-forget-'))
  const paths = buildPaths({ override: dataRoot, mac: false })
  fs.mkdirSync(paths.dataRoot, { recursive: true })
  saveRetailManifest(paths, local([localFile()]))
  forgetRetailFile(paths, 'Reckless/RecklessVF.otf')
  assert.equal(loadRetailManifest(paths).files['Reckless/RecklessVF.otf'], undefined)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { applyRetailSync, RETAIL_PART_SUFFIX, sweepRetailPartials } from './retail-apply.ts'
import { emptyRetailLocalManifest, type RetailDriftItem } from '../shared/retail.ts'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-retail-'))
}

function added(relativePath: string, bytes: number, overrides: Record<string, unknown> = {}): RetailDriftItem {
  return {
    kind: 'added',
    relativePath,
    glyphsFile: 'Reckless',
    remote: {
      key: `Reckless/rev-1/${path.basename(relativePath)}`,
      relativePath,
      size: bytes,
      etag: 'etag-1',
      uploaded: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  }
}

const payload = (size: number) => new Uint8Array(size).fill(7)

test('a sync writes files atomically and records them in the manifest', async () => {
  const root = tempRoot()
  const saved: number[] = []
  const result = await applyRetailSync({
    root,
    drift: [added('Reckless/RecklessVF.otf', 8)],
    download: async () => payload(8),
    manifest: emptyRetailLocalManifest(),
    persist: (manifest) => saved.push(Object.keys(manifest.files).length),
  })

  assert.equal(result.written, 1)
  assert.equal(result.failed, 0)
  const target = path.join(root, 'Reckless', 'RecklessVF.otf')
  assert.equal(fs.readFileSync(target).length, 8)
  assert.deepEqual(fs.readdirSync(path.join(root, 'Reckless')), ['RecklessVF.otf'])
  assert.equal(result.manifest.files['Reckless/RecklessVF.otf'].etag, 'etag-1')
  assert.equal(result.manifest.files['Reckless/RecklessVF.otf'].revisionId, 'rev-1')
  assert.deepEqual(saved, [1])
})

test('no .part file survives a successful write', async () => {
  const root = tempRoot()
  await applyRetailSync({
    root,
    drift: [added('Reckless/A.otf', 4)],
    download: async () => payload(4),
    manifest: emptyRetailLocalManifest(),
    persist: () => {},
  })
  const leftovers = fs
    .readdirSync(path.join(root, 'Reckless'))
    .filter((name) => name.endsWith(RETAIL_PART_SUFFIX))
  assert.deepEqual(leftovers, [])
})

test('a short download is refused and leaves the previous file intact', async () => {
  const root = tempRoot()
  fs.mkdirSync(path.join(root, 'Reckless'), { recursive: true })
  const target = path.join(root, 'Reckless', 'A.otf')
  fs.writeFileSync(target, Buffer.from('original'))

  const result = await applyRetailSync({
    root,
    // The manifest promises 100 bytes but the worker returns 3 — a truncated response.
    drift: [added('Reckless/A.otf', 100)],
    download: async () => payload(3),
    manifest: emptyRetailLocalManifest(),
    persist: () => {},
  })

  assert.equal(result.written, 0)
  assert.equal(result.failed, 1)
  assert.match(result.errors[0], /expected 100 bytes, got 3/)
  assert.equal(fs.readFileSync(target, 'utf8'), 'original')
  assert.equal(fs.existsSync(`${target}${RETAIL_PART_SUFFIX}`), false)
})

test('a failing download does not abort the rest of the batch', async () => {
  const root = tempRoot()
  const result = await applyRetailSync({
    root,
    drift: [added('Reckless/A.otf', 4), added('Reckless/B.otf', 4), added('Reckless/C.otf', 4)],
    download: async (key) => {
      if (key.endsWith('B.otf')) throw new Error('network went away')
      return payload(4)
    },
    manifest: emptyRetailLocalManifest(),
    persist: () => {},
    concurrency: 3,
  })

  assert.equal(result.written, 2)
  assert.equal(result.failed, 1)
  assert.match(result.errors[0], /B\.otf: network went away/)
  assert.equal(fs.existsSync(path.join(root, 'Reckless', 'A.otf')), true)
  assert.equal(fs.existsSync(path.join(root, 'Reckless', 'C.otf')), true)
  assert.equal(fs.existsSync(path.join(root, 'Reckless', 'B.otf')), false)
})

test('a traversal path is refused rather than written', async () => {
  const root = tempRoot()
  let downloaded = false
  const result = await applyRetailSync({
    root,
    drift: [added('../escape.otf', 4)],
    download: async () => {
      downloaded = true
      return payload(4)
    },
    manifest: emptyRetailLocalManifest(),
    persist: () => {},
  })

  assert.equal(result.failed, 1)
  assert.match(result.errors[0], /unsafe path/)
  assert.equal(downloaded, false, 'an unsafe path must be refused before any download')
  assert.equal(fs.existsSync(path.join(path.dirname(root), 'escape.otf')), false)
})

test('removed drift is reported but never downloaded or deleted', async () => {
  const root = tempRoot()
  fs.mkdirSync(path.join(root, 'Reckless'), { recursive: true })
  const target = path.join(root, 'Reckless', 'Gone.otf')
  fs.writeFileSync(target, Buffer.from('still here'))

  const result = await applyRetailSync({
    root,
    drift: [
      {
        kind: 'removed',
        relativePath: 'Reckless/Gone.otf',
        glyphsFile: 'Reckless',
        local: {
          key: 'Reckless/rev-1/Gone.otf',
          relativePath: 'Reckless/Gone.otf',
          size: 10,
          etag: 'e',
          glyphsFile: 'Reckless',
          revisionId: 'rev-1',
          syncedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ],
    download: async () => {
      throw new Error('must not download a removed file')
    },
    manifest: emptyRetailLocalManifest(),
    persist: () => {},
  })

  assert.equal(result.written, 0)
  assert.equal(result.failed, 0)
  assert.equal(result.skipped, 1)
  assert.equal(fs.readFileSync(target, 'utf8'), 'still here')
})

test('an interrupted run persists progress so it is not re-downloaded', async () => {
  const root = tempRoot()
  const snapshots: string[][] = []
  const result = await applyRetailSync({
    root,
    drift: [added('Reckless/A.otf', 4), added('Reckless/B.otf', 4)],
    download: async () => payload(4),
    manifest: emptyRetailLocalManifest(),
    persist: (manifest) => snapshots.push(Object.keys(manifest.files).sort()),
    concurrency: 1,
  })
  assert.equal(result.written, 2)
  // One persist per batch, so a crash after the first batch still remembers A.
  assert.deepEqual(snapshots, [['Reckless/A.otf'], ['Reckless/A.otf', 'Reckless/B.otf']])
})

test('sweepRetailPartials clears leftovers from an interrupted run', () => {
  const root = tempRoot()
  fs.mkdirSync(path.join(root, 'Reckless'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Reckless', `A.otf${RETAIL_PART_SUFFIX}`), 'x')
  fs.writeFileSync(path.join(root, 'Reckless', 'B.otf'), 'keep')

  assert.equal(sweepRetailPartials(root), 1)
  assert.deepEqual(fs.readdirSync(path.join(root, 'Reckless')), ['B.otf'])
})

test('the retail root is created when it does not exist yet', async () => {
  const parent = tempRoot()
  const root = path.join(parent, 'DISPLAAY Retail')
  assert.equal(fs.existsSync(root), false)
  await applyRetailSync({
    root,
    drift: [],
    download: async () => payload(0),
    manifest: emptyRetailLocalManifest(),
    persist: () => {},
  })
  assert.equal(fs.existsSync(root), true)
})

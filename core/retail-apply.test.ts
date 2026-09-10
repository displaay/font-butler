import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { applyRetailSync, RETAIL_PART_SUFFIX, sweepRetailPartials } from './retail-apply.ts'
import { noopFontNative } from './native.ts'
import { emptyRetailLocalManifest, type RetailDriftItem } from '../shared/retail.ts'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-retail-'))
}

function dirs(root = tempRoot()) {
  const userFontsDir = path.join(root, 'Fonts')
  const stagingDir = path.join(root, 'staging')
  const rollbackDir = path.join(root, 'rollback')
  fs.mkdirSync(userFontsDir, { recursive: true })
  fs.mkdirSync(stagingDir, { recursive: true })
  fs.mkdirSync(rollbackDir, { recursive: true })
  return { root, userFontsDir, stagingDir, rollbackDir, native: noopFontNative() }
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

test('a sync flattens into Fonts atomically and records them in the manifest', async () => {
  const { userFontsDir, stagingDir, rollbackDir, native } = dirs()
  const saved: number[] = []
  const result = await applyRetailSync({
    userFontsDir,
    stagingDir,
    rollbackDir,
    native,
    drift: [added('Reckless/RecklessVF.otf', 8)],
    download: async () => payload(8),
    manifest: emptyRetailLocalManifest(),
    persist: (manifest) => saved.push(Object.keys(manifest.files).length),
  })

  assert.equal(result.written, 1)
  assert.equal(result.failed, 0)
  const target = path.join(userFontsDir, 'RecklessVF.otf')
  assert.equal(fs.readFileSync(target).length, 8)
  assert.deepEqual(fs.readdirSync(userFontsDir), ['RecklessVF.otf'])
  assert.equal(result.manifest.files['Reckless/RecklessVF.otf'].etag, 'etag-1')
  assert.equal(result.manifest.files['Reckless/RecklessVF.otf'].revisionId, 'rev-1')
  assert.equal(result.manifest.files['Reckless/RecklessVF.otf'].installedPath, target)
  assert.deepEqual(saved, [1])
})

test('no .part file survives a successful write', async () => {
  const { userFontsDir, stagingDir, rollbackDir, native } = dirs()
  await applyRetailSync({
    userFontsDir,
    stagingDir,
    rollbackDir,
    native,
    drift: [added('Reckless/A.otf', 4)],
    download: async () => payload(4),
    manifest: emptyRetailLocalManifest(),
    persist: () => {},
  })
  const leftovers = fs.readdirSync(stagingDir).filter((name) => name.endsWith(RETAIL_PART_SUFFIX))
  assert.deepEqual(leftovers, [])
  assert.equal(fs.existsSync(path.join(userFontsDir, 'A.otf')), true)
})

test('a short download is refused and leaves the previous file intact', async () => {
  const { userFontsDir, stagingDir, rollbackDir, native } = dirs()
  const target = path.join(userFontsDir, 'A.otf')
  fs.writeFileSync(target, Buffer.from('original'))

  const result = await applyRetailSync({
    userFontsDir,
    stagingDir,
    rollbackDir,
    native,
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
  const { userFontsDir, stagingDir, rollbackDir, native } = dirs()
  const result = await applyRetailSync({
    userFontsDir,
    stagingDir,
    rollbackDir,
    native,
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
  assert.equal(fs.existsSync(path.join(userFontsDir, 'A.otf')), true)
  assert.equal(fs.existsSync(path.join(userFontsDir, 'C.otf')), true)
  assert.equal(fs.existsSync(path.join(userFontsDir, 'B.otf')), false)
})

test('a traversal path is refused rather than written', async () => {
  const { userFontsDir, stagingDir, rollbackDir, root, native } = dirs()
  let downloaded = false
  const result = await applyRetailSync({
    userFontsDir,
    stagingDir,
    rollbackDir,
    native,
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
  assert.equal(fs.existsSync(path.join(userFontsDir, 'escape.otf')), false)
})

test('removed drift is reported but never downloaded or deleted', async () => {
  const { userFontsDir, stagingDir, rollbackDir, native } = dirs()
  const target = path.join(userFontsDir, 'Gone.otf')
  fs.writeFileSync(target, Buffer.from('still here'))

  const result = await applyRetailSync({
    userFontsDir,
    stagingDir,
    rollbackDir,
    native,
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
  const { userFontsDir, stagingDir, rollbackDir, native } = dirs()
  const snapshots: string[][] = []
  const result = await applyRetailSync({
    userFontsDir,
    stagingDir,
    rollbackDir,
    native,
    drift: [added('Reckless/A.otf', 4), added('Reckless/B.otf', 4)],
    download: async () => payload(4),
    manifest: emptyRetailLocalManifest(),
    persist: (manifest) => snapshots.push(Object.keys(manifest.files).sort()),
    concurrency: 1,
  })
  assert.equal(result.written, 2)
  assert.deepEqual(snapshots, [['Reckless/A.otf'], ['Reckless/A.otf', 'Reckless/B.otf']])
})

test('sweepRetailPartials clears leftovers from an interrupted run', () => {
  const { stagingDir, userFontsDir } = dirs()
  fs.writeFileSync(path.join(stagingDir, `A.otf${RETAIL_PART_SUFFIX}`), 'x')
  fs.writeFileSync(path.join(userFontsDir, 'B.otf'), 'keep')

  assert.equal(sweepRetailPartials(stagingDir), 1)
  assert.deepEqual(fs.readdirSync(stagingDir), [])
  assert.deepEqual(fs.readdirSync(userFontsDir), ['B.otf'])
})

test('the Fonts folder is created when it does not exist yet', async () => {
  const parent = tempRoot()
  const userFontsDir = path.join(parent, 'Fonts')
  const stagingDir = path.join(parent, 'staging')
  const rollbackDir = path.join(parent, 'rollback')
  assert.equal(fs.existsSync(userFontsDir), false)
  await applyRetailSync({
    userFontsDir,
    stagingDir,
    rollbackDir,
    native: noopFontNative(),
    drift: [],
    download: async () => payload(0),
    manifest: emptyRetailLocalManifest(),
    persist: () => {},
  })
  assert.equal(fs.existsSync(userFontsDir), true)
})

test('a parked dest is rewritten in place without replacing Fonts', async () => {
  const { userFontsDir, stagingDir, rollbackDir, native } = dirs()
  const parked = path.join(stagingDir, '..', 'Disabled', 'Parked.otf')
  fs.mkdirSync(path.dirname(parked), { recursive: true })
  fs.writeFileSync(parked, Buffer.from('old'))

  const result = await applyRetailSync({
    userFontsDir,
    stagingDir,
    rollbackDir,
    native,
    destFor: () => ({ dest: parked, parked: true }),
    drift: [added('Reckless/Parked.otf', 4)],
    download: async () => payload(4),
    manifest: emptyRetailLocalManifest(),
    persist: () => {},
  })

  assert.equal(result.written, 1)
  assert.equal(fs.readFileSync(parked).length, 4)
  assert.equal(fs.existsSync(path.join(userFontsDir, 'Parked.otf')), false)
})

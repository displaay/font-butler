import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { inspectCompareFiles } from './compare-files.ts'
import { parseFontFile } from './parse.ts'
import { standaloneSfntFace } from './rename.ts'
import { FontButlerService } from './service.ts'
import { tempPaths, writeTestCollection, writeTestFont } from './test-util.ts'

const seedInter = path.join(import.meta.dirname, '../seed-fonts/InterVariable.ttf')
const seedPlex = path.join(import.meta.dirname, '../seed-fonts/IBMPlexMono-Regular.ttf')

test('two font files that are not in the catalog can be compared', () => {
  const paths = tempPaths('font-butler-compare-')
  const outside = fs.mkdtempSync(path.join(paths.dataRoot, '..', 'compare-outside-'))
  const alpha = path.join(outside, 'Alpha-Regular.ttf')
  const beta = path.join(outside, 'Beta-Bold.otf')
  try {
    writeTestFont(alpha, 'Alpha Compare', 'AlphaCompare-Regular', { style: 'Regular', weight: 400 })
    writeTestFont(beta, 'Beta Compare', 'BetaCompare-Bold', { style: 'Bold', format: 'otf', weight: 700 })
    const service = new FontButlerService(paths)
    try {
      assert.equal(service.listCatalog().length, 0)
      const result = service.inspectComparePaths([alpha, beta])
      assert.equal(service.listCatalog().length, 0)
      assert.equal(result.errors.length, 0)
      assert.deepEqual(
        result.families.map((family) => family.name).sort(),
        ['Alpha Compare', 'Beta Compare'],
      )
      const files = result.families.flatMap((family) => family.faces.map((face) => face.filePath)).sort()
      assert.deepEqual(files, [fs.realpathSync(alpha), fs.realpathSync(beta)].sort())
      const bytes = service.compareFontBytes(files[0]!)
      assert.ok(bytes.buffer.length > 100)
      assert.throws(() => service.compareFontBytes(path.join(outside, 'notes.txt')), /not open for comparison/)
    } finally {
      service.dispose()
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true })
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('each face of a collection is served as that face', () => {
  const paths = tempPaths('font-butler-compare-collection-')
  const collection = path.join(paths.dataRoot, 'Collect.ttc')
  try {
    writeTestCollection(collection, [
      { family: 'Collect', psName: 'Collect-Regular', style: 'Regular', weight: 400 },
      { family: 'Collect', psName: 'Collect-Bold', style: 'Bold', weight: 700 },
    ])
    const file = fs.readFileSync(collection)
    assert.equal(file.subarray(0, 4).toString('ascii'), 'ttcf')
    const regularBytes = standaloneSfntFace(file, 0)
    const boldBytes = standaloneSfntFace(file, 1)
    assert.equal(regularBytes.collection, true)
    assert.notEqual(regularBytes.buffer.subarray(0, 4).toString('ascii'), 'ttcf')
    assert.notEqual(boldBytes.buffer.subarray(0, 4).toString('ascii'), 'ttcf')
    const regularPath = path.join(paths.dataRoot, 'regular.ttf')
    const boldPath = path.join(paths.dataRoot, 'bold.ttf')
    fs.writeFileSync(regularPath, regularBytes.buffer)
    fs.writeFileSync(boldPath, boldBytes.buffer)
    const regular = parseFontFile(regularPath, { previewMeta: false, previewSample: false })
    const bold = parseFontFile(boldPath, { previewMeta: false, previewSample: false })
    assert.equal(regular.faces[0]?.postscriptName, 'Collect-Regular')
    assert.equal(bold.faces[0]?.postscriptName, 'Collect-Bold')
    assert.notEqual(regular.faces[0]?.postscriptName, bold.faces[0]?.postscriptName)

    const service = new FontButlerService(paths)
    try {
      service.inspectComparePaths([collection])
      const served = service.compareFontBytes(fs.realpathSync(collection), 1)
      assert.notEqual(served.buffer.subarray(0, 4).toString('ascii'), 'ttcf')
      assert.equal(served.mime, 'font/ttf')
      const servedPath = path.join(paths.dataRoot, 'served.ttf')
      fs.writeFileSync(servedPath, served.buffer)
      const parsed = parseFontFile(servedPath, { previewMeta: false, previewSample: false })
      assert.equal(parsed.faces[0]?.postscriptName, 'Collect-Bold')
    } finally {
      service.dispose()
    }
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
})

test('seed fonts compare without being imported', () => {
  assert.equal(fs.existsSync(seedInter), true)
  assert.equal(fs.existsSync(seedPlex), true)
  const result = inspectCompareFiles([seedInter, seedPlex])
  assert.equal(result.families.length, 2)
  assert.ok(result.families.some((family) => /inter/i.test(family.name)))
  assert.ok(result.families.some((family) => /plex/i.test(family.name)))
  assert.equal(result.paths.length, 2)
})

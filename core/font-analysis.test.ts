import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { onEvent } from './events.ts'
import {
  analyzeFontFile,
  fontAnalysisStats,
  resetFontAnalysisCache,
} from './font-analysis.ts'
import { withService, writeTestFont } from './test-util.ts'

const HEBREW = [65, 97, 0x05d0, 0x05d1, 0x05d2, 0x05d3, 0x05d4, 0x05d5]

test('analyzeFontFile caches parse and fingerprint by path+mtime+size', async () => {
  await withService(async (_service, paths) => {
    const file = path.join(paths.dataRoot, 'Cache.ttf')
    writeTestFont(file, 'Cache', 'Cache-Regular', { codePoints: HEBREW })
    resetFontAnalysisCache()
    const first = await analyzeFontFile(file)
    const afterFirst = fontAnalysisStats()
    const second = await analyzeFontFile(file)
    const afterSecond = fontAnalysisStats()
    assert.equal(first.parsed.previewSample, 'א')
    assert.equal(second.fingerprint, first.fingerprint)
    assert.equal(second.parsed.previewSample, first.parsed.previewSample)
    assert.equal(afterSecond.parses, afterFirst.parses)
    assert.ok(afterSecond.cacheHits >= afterFirst.cacheHits + 1)
  })
})

test('planImport feeds apply so the same file is not parsed twice', async () => {
  await withService(async (service, paths) => {
    await service.init()
    await service.updateSettings({ installAfterUpload: false })
    const file = path.join(paths.dataRoot, 'Once.ttf')
    writeTestFont(file, 'Once', 'Once-Regular', { codePoints: HEBREW })
    resetFontAnalysisCache()
    const plan = await service.planImport([file])
    const afterPlan = fontAnalysisStats()
    assert.equal(plan.items[0]?.previewSample, 'א')
    assert.ok(afterPlan.parses >= 1)
    const applied = await service.applyPlan(plan.id)
    const afterApply = fontAnalysisStats()
    assert.equal(applied.entries[0]?.previewSample, 'א')
    assert.equal(afterApply.parses, afterPlan.parses)
    assert.ok(afterApply.cacheHits >= afterPlan.cacheHits)
  })
})

test('planImport yields between files so the event loop can run', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const files = [0, 1, 2, 3, 4].map((index) => {
      const file = path.join(paths.dataRoot, `Tick-${index}.ttf`)
      writeTestFont(file, `Tick${index}`, `Tick${index}-Regular`)
      return file
    })
    resetFontAnalysisCache()
    let ranDuring = false
    const plan = service.planImport(files)
    setImmediate(() => {
      ranDuring = true
    })
    await plan
    assert.ok(fontAnalysisStats().yields >= files.length)
    assert.equal(ranDuring, true)
  })
})

test('importPaths emits a placeholder catalog card then upgrades the sample', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const file = path.join(paths.dataRoot, 'Hebrew.ttf')
    writeTestFont(file, 'Hebrew', 'Hebrew-Regular', { codePoints: HEBREW })
    resetFontAnalysisCache()
    const samples: Array<string | undefined> = []
    const stop = onEvent((event) => {
      if (event.type !== 'catalog') return
      const entry = event.entries.find((item) => item.sourcePath === file)
      if (entry) samples.push(entry.previewSample)
    })
    try {
      const result = await service.importPaths([file])
      assert.equal(result.entries[0]?.previewSample, 'א')
    } finally {
      stop()
    }
    assert.ok(
      samples.some((sample) => sample == null),
      'grid should see a pending sample before cmap probing finishes',
    )
    assert.ok(samples.some((sample) => sample === 'א'))
    assert.equal(service.listCatalog()[0]?.previewSample, 'א')
  })
})

test('startup does not re-parse a stored non-Latin sample when the stamp is unchanged', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const file = path.join(paths.dataRoot, 'Hebrew.ttf')
    writeTestFont(file, 'Hebrew', 'Hebrew-Regular', { codePoints: HEBREW })
    const imported = await service.importPaths([file])
    assert.equal(imported.entries[0]?.previewSample, 'א')
    resetFontAnalysisCache()
    const before = fontAnalysisStats()
    await service.init()
    const after = fontAnalysisStats()
    assert.equal(service.listCatalog()[0]?.previewSample, 'א')
    assert.equal(after.parses, before.parses)
  })
})

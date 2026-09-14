import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { onEvent } from './events.ts'
import {
  __failAfterPartialOnceForTests,
  analysisFromPlanItem,
  analyzeFontFile,
  closeFontAnalysisWorker,
  fontAnalysisStats,
  resetFontAnalysisCache,
} from './font-analysis.ts'
import { withService, writeTestFont } from './test-util.ts'

const HEBREW = [65, 97, 0x05d0, 0x05d1, 0x05d2, 0x05d3, 0x05d4, 0x05d5]
const ARABIC = [65, 97, 0x0627, 0x0628, 0x062a, 0x062c, 0x062f, 0x0631, 0x0633, 0x0639, 0x0644, 0x0645, 0x0646, 0x064a]

after(async () => {
  await closeFontAnalysisWorker()
})

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

test('analysisFromPlanItem does not reuse faces when mtime or size changed', async () => {
  await withService(async (_service, paths) => {
    const file = path.join(paths.dataRoot, 'Swap.ttf')
    writeTestFont(file, 'Swap', 'Swap-Regular', { codePoints: HEBREW })
    const first = await analyzeFontFile(file)
    const item = {
      path: file,
      faces: first.parsed.faces,
      format: first.parsed.format,
      previewSample: first.parsed.previewSample,
      fingerprint: first.fingerprint,
      sourceMtimeMs: first.mtimeMs,
      sourceSize: first.size,
    }
    assert.equal(analysisFromPlanItem(item)?.parsed.previewSample, 'א')
    writeTestFont(file, 'Swap', 'Swap-Regular', { codePoints: ARABIC })
    const later = Date.now() / 1000 + 5
    fs.utimesSync(file, later, later)
    assert.equal(analysisFromPlanItem(item), undefined)
  })
})

test('applyPlan re-analyzes when the file changes after planImport', async () => {
  await withService(async (service, paths) => {
    await service.init()
    await service.updateSettings({ installAfterUpload: false })
    const file = path.join(paths.dataRoot, 'Swap.ttf')
    writeTestFont(file, 'Swap', 'Swap-Regular', { codePoints: HEBREW })
    const plan = await service.planImport([file])
    assert.equal(plan.items[0]?.previewSample, 'א')
    const afterPlan = fontAnalysisStats()
    writeTestFont(file, 'Swap', 'Swap-Regular', { codePoints: ARABIC })
    const later = Date.now() / 1000 + 5
    fs.utimesSync(file, later, later)
    const applied = await service.applyPlan(plan.id)
    const afterApply = fontAnalysisStats()
    assert.equal(applied.entries[0]?.previewSample, 'ع')
    assert.ok(afterApply.parses > afterPlan.parses)
  })
})

test('a worker job error does not retry parse on the API thread', async () => {
  await withService(async (_service, paths) => {
    const good = path.join(paths.dataRoot, 'Good.ttf')
    writeTestFont(good, 'Good', 'Good-Regular', { codePoints: HEBREW })
    resetFontAnalysisCache()
    await analyzeFontFile(good)
    const afterGood = fontAnalysisStats()
    if (afterGood.workerJobs === 0 || afterGood.fallbackJobs > 0) return
    const file = path.join(paths.dataRoot, 'Bad.ttf')
    fs.writeFileSync(file, 'not a font')
    const before = fontAnalysisStats()
    await assert.rejects(() => analyzeFontFile(file))
    const after = fontAnalysisStats()
    assert.ok(after.workerJobs > before.workerJobs)
    assert.equal(after.fallbackJobs, before.fallbackJobs)
  })
})

test('importPaths rolls back a catalog card if preview fails after faces', async () => {
  await withService(async (service, paths) => {
    await service.init()
    const file = path.join(paths.dataRoot, 'Partial.ttf')
    writeTestFont(file, 'Partial', 'Partial-Regular', { codePoints: HEBREW })
    __failAfterPartialOnceForTests()
    const result = await service.importPaths([file])
    assert.equal(result.entries.length, 0)
    assert.ok(result.errors.some((error) => error.includes('fail after partial')))
    assert.equal(service.listCatalog().length, 0)
  })
})

test('closeFontAnalysisWorker terminates the worker and is idempotent', async () => {
  await withService(async (_service, paths) => {
    const file = path.join(paths.dataRoot, 'Again.ttf')
    writeTestFont(file, 'Again', 'Again-Regular', { codePoints: HEBREW })
    const first = await analyzeFontFile(file)
    assert.equal(first.parsed.previewSample, 'א')
    await closeFontAnalysisWorker()
    await closeFontAnalysisWorker()
  })
})

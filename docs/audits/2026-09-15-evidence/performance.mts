import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { withService, writeTestFont } from '../../../core/test-util.ts'
import { saveCatalog } from '../../../core/catalog.ts'
import { parseFontFile } from '../../../core/parse.ts'
import { groupCatalog, countLibraryFilters } from '../../../src/lib/group.ts'
import { closeFontAnalysisWorker } from '../../../core/font-analysis.ts'
import { scanSystemFonts } from '../../../core/system.ts'

const keepAlive = setInterval(() => {}, 1000)
const report = (probe: string, value: unknown) => console.log(JSON.stringify({probe,value}))
try {
  await withService(async (service, paths) => {
    const font = path.join(paths.sourcesDir, 'Benchmark.ttf')
    writeTestFont(font, 'Benchmark', 'Benchmark-Regular')
    const parsed = parseFontFile(font)
    for (const count of [100, 1000, 5000]) {
      const entries = Array.from({length:count}, (_,i) => ({
        id:`benchmark-${i}`, sourcePath:font, sourceMtimeMs:1, sourceSize:900,
        sourcePresent:true, sourceAvailability:'present' as const, status:'uninstalled' as const,
        faces:parsed.faces.map(f=>({...f,familyName:`Benchmark ${Math.floor(i/10)}`,postscriptName:`Benchmark-${i}`})),
        format:'ttf',previewSample:'AA',addedAt:1,updatedAt:1,
      }))
      saveCatalog(paths,{version:1,entries})
      // Warm disk cache; report five batches rather than a single cold outlier.
      service.fontBytesForRevision('benchmark-0')
      const samples:number[]=[]
      for(let repeat=0;repeat<5;repeat++) {
        const start=performance.now()
        for(let i=0;i<50;i++) service.fontBytesForRevision(`benchmark-${i}`)
        samples.push(performance.now()-start)
      }
      const grouping=performance.now()
      for(let i=0;i<5;i++) {groupCatalog(entries); countLibraryFilters(entries)}
      report('preview-catalog-scaling',{count,catalogBytes:fs.statSync(paths.catalogPath).size,
        fiftyPreviewRequestsMs:samples.map(n=>Math.round(n)), groupAndFilterMeanMs:Math.round((performance.now()-grouping)/5)})
    }
  })
  await withService(async (_service, paths) => {
    // Read only the real system font trees; all cache writes stay in the temporary data root.
    paths.computerFontsDir='/Library/Fonts'
    paths.systemFontsDir='/System/Library/Fonts'
    const cold=performance.now()
    const faces=scanSystemFonts(paths)
    const coldMs=performance.now()-cold
    const warm=performance.now()
    scanSystemFonts(paths)
    report('system-scan',{faces:faces.length,coldMs:Math.round(coldMs),warmMs:Math.round(performance.now()-warm)})
  })
} finally {
  await closeFontAnalysisWorker()
  clearInterval(keepAlive)
}

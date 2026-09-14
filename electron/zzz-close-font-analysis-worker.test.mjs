import { after, test } from 'node:test'
import { closeFontAnalysisWorker } from '../core/font-analysis.ts'

after(async () => {
  await closeFontAnalysisWorker()
})

test('terminate the font analysis worker so the test process can exit', async () => {
  await closeFontAnalysisWorker()
})

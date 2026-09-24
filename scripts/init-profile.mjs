#!/usr/bin/env node
/**
 * Per-step init timing (same fixture shape as blank-window-benchmark.mjs).
 * Usage: node scripts/init-profile.mjs 11000
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const n = Number(process.argv[2] || 11000)

function writeTestFont(dest) {
  const script = `
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder([".notdef", "A"])
fb.setupCharacterMap({65: "A"})
empty = TTGlyphPen(None).glyph()
pen = TTGlyphPen(None)
pen.moveTo((0, 0)); pen.lineTo((500, 0)); pen.lineTo((250, 700)); pen.closePath()
fb.setupGlyf({".notdef": empty, "A": pen.glyph()})
fb.setupHorizontalMetrics({".notdef": (500, 0), "A": (600, 0)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "Bench", "styleName": "Regular", "uniqueFontIdentifier": "Bench-Regular", "fullName": "Bench Regular", "psName": "Bench-Regular", "version": "Version 1.000"})
fb.setupOS2(); fb.setupPost()
fb.save(${JSON.stringify(dest)})
`
  execFileSync('python3', ['-c', script], { stdio: 'pipe' })
}

function buildFixture(count) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `fb-prof-${count}-`))
  const userFontsDir = path.join(dataRoot, 'user-fonts')
  const watchRoot = path.join(dataRoot, 'watch')
  fs.mkdirSync(userFontsDir, { recursive: true })
  fs.mkdirSync(watchRoot, { recursive: true })
  const template = path.join(dataRoot, 'template.ttf')
  writeTestFont(template)
  const templateBuf = fs.readFileSync(template)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    const installed = path.join(userFontsDir, `Font-${i}.ttf`)
    const source = path.join(watchRoot, `Src-${i}.ttf`)
    const buf = Buffer.concat([templateBuf, Buffer.from(`id-${i}`)])
    fs.writeFileSync(installed, buf)
    fs.writeFileSync(source, buf)
    const st = fs.statSync(source)
    entries.push({
      id: `entry-${i}`,
      status: 'installed',
      sourcePath: source,
      sourcePresent: true,
      sourceMtimeMs: st.mtimeMs,
      sourceSize: st.size,
      sourceFingerprint: `fp-${i}`,
      installedPath: installed,
      format: 'ttf',
      previewSample: 'Aa',
      faces: [{ postscriptName: 'Bench-Regular', familyName: 'Bench', subfamilyName: 'Regular' }],
      installations: [
        { destinationId: 'macos', path: installed, verification: 'file-present', fingerprint: `fp-${i}` },
      ],
      addedAt: new Date().toISOString(),
    })
  }
  fs.writeFileSync(path.join(dataRoot, 'catalog.json'), JSON.stringify({ version: 1, entries }))
  fs.writeFileSync(
    path.join(dataRoot, 'settings.json'),
    JSON.stringify({
      onboardingCompleted: true,
      folders: [{ id: 'watch-1', root: watchRoot, policy: 'library', watching: true }],
    }),
  )
  return dataRoot
}

async function time(label, fn) {
  const t0 = performance.now()
  await fn()
  const ms = Math.round(performance.now() - t0)
  console.log(`${label}: ${ms} ms`)
  return ms
}

const dataDir = buildFixture(n)
process.env.FONT_BUTLER_DATA = dataDir
process.env.FONT_BUTLER_TEST = '1'

const { spawnSync } = await import('node:child_process')
if (!process.execArgv.some((arg) => arg.includes('tsx'))) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', process.argv[1], String(n)], {
    stdio: 'inherit',
    env: process.env,
  })
  process.exit(result.status ?? 1)
}

const { FontButlerService } = await import('../core/service.ts')
const { closeAllWatchers } = await import('../core/watch.ts')

const service = new FontButlerService()
console.log(`Init profile N=${n} (Linux VM)`)
await time('initCatalogPhase', () => service.initCatalogPhase())
await time('adoptUserFonts', () => service.adoptUserFonts())
await time('detachRenamedInstallSources', () => service.detachRenamedInstallSources())
await time('seedIfEmpty', () => service.seedIfEmpty())
await time('refreshSourceStatuses(false)', () => service.refreshSourceStatuses(false))
await time('syncWatchers', async () => {
  const { syncWatchers } = await import('../core/watch.ts')
  await syncWatchers(service.paths)
})
await time('reconcileWatchedSources', async () => {
  const { reconcileWatchedSources } = await import('../core/watch.ts')
  await reconcileWatchedSources(service.paths)
})
await time('refreshUserFontsWatcher', () => service.refreshUserFontsWatcher())
await time('refreshInboxWatcher(importExisting:false)', () =>
  service.refreshInboxWatcher(service.watchingFolderRoots(), { importExisting: false }),
)

await closeAllWatchers()
fs.rmSync(dataDir, { recursive: true, force: true })

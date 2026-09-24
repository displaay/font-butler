#!/usr/bin/env node
/**
 * Startup harness: API listening, catalog ready, background init complete.
 * Usage: node scripts/blank-window-benchmark.mjs 2000 11000 20000
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const counts = process.argv.slice(2).map(Number).filter((n) => n > 0)
if (counts.length === 0) counts.push(2000, 11000, 20000)

/** Audit baseline: full init before listen (Linux VM). */
const auditListenMs = {
  2000: 4118,
  6000: 11814,
  9000: 18346,
  11000: 20019,
  20000: null,
}

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

function buildFixture(n) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `fb-bench-${n}-`))
  const userFontsDir = path.join(dataRoot, 'user-fonts')
  const watchRoot = path.join(dataRoot, 'watch')
  fs.mkdirSync(userFontsDir, { recursive: true })
  fs.mkdirSync(watchRoot, { recursive: true })
  const template = path.join(dataRoot, 'template.ttf')
  writeTestFont(template)
  const templateBuf = fs.readFileSync(template)
  const entries = []
  for (let i = 0; i < n; i += 1) {
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

function spawnWorker(dataDir, port) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      FONT_BUTLER_SERVE: '1',
      FONT_BUTLER_DATA: dataDir,
      FONT_BUTLER_API_PORT: String(port),
    }
    delete env.FONT_BUTLER_TEST
    delete env.FONT_BUTLER_DEV_BOOTSTRAP
    const t0 = Date.now()
    let listenMs = null
    let catalogMs = null
    let initMs = null
    let buffer = ''
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const finish = (error, result) => {
      child.kill()
      if (error) reject(error)
      else resolve(result)
    }
    child.on('exit', (code) => {
      if (initMs === null) {
        finish(new Error(`worker exited ${code} before init complete\n${buffer.slice(-800)}`))
      }
    })
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      if (listenMs === null && /Font Buttler API on /.test(buffer)) listenMs = Date.now() - t0
      if (catalogMs === null && /Font Buttler catalog ready/.test(buffer)) catalogMs = Date.now() - t0
      if (initMs === null && /Font Buttler init complete/.test(buffer)) {
        initMs = Date.now() - t0
        finish(null, { listenMs, catalogMs, initMs })
      }
    })
    child.stderr.on('data', (chunk) => {
      buffer += String(chunk)
    })
  })
}

console.log('Blank-window startup benchmark (Linux VM)')
console.log(
  '| N | audit listen (old) | listen | catalog ready | background complete |',
)
console.log('|---:|---:|---:|---:|---:|')

for (const n of counts) {
  process.stderr.write(`Building fixture N=${n}…\n`)
  const dataDir = buildFixture(n)
  try {
    const result = await spawnWorker(dataDir, 43180 + (n % 10))
    const audit = auditListenMs[n] ?? '—'
    console.log(
      `| ${n} | ${audit} | ${result.listenMs} | ${result.catalogMs} | ${result.initMs} |`,
    )
  } catch (error) {
    console.log(`| ${n} | — | FAIL | — | ${error instanceof Error ? error.message : error} |`)
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

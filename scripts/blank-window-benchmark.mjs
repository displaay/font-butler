#!/usr/bin/env node
/**
 * Measures time to "Font Buttler API on …" (listening) and "Font Buttler init complete".
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

function writeTestFont(dest, family, psName) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
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
fb.setupNameTable({"familyName": ${JSON.stringify(family)}, "styleName": "Regular", "uniqueFontIdentifier": ${JSON.stringify(psName)}, "fullName": ${JSON.stringify(`${family} Regular`)}, "psName": ${JSON.stringify(psName)}, "version": "Version 1.000"})
fb.setupOS2(); fb.setupPost()
fb.save(${JSON.stringify(dest)})
`
  execFileSync('python3', ['-c', script], { stdio: 'pipe' })
}

function buildFixture(n) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `fb-bench-${n}-`))
  const userFontsDir = path.join(dataRoot, 'user-fonts')
  const sourcesDir = path.join(dataRoot, 'sources')
  const watchRoot = path.join(dataRoot, 'watch')
  fs.mkdirSync(userFontsDir, { recursive: true })
  fs.mkdirSync(watchRoot, { recursive: true })
  const template = path.join(dataRoot, 'template.ttf')
  writeTestFont(template, 'Bench', 'Bench-Regular')
  const templateBuf = fs.readFileSync(template)
  const entries = []
  for (let i = 0; i < n; i += 1) {
    const installed = path.join(userFontsDir, `Font-${i}.ttf`)
    const source = path.join(watchRoot, `Src-${i}.ttf`)
    const buf = Buffer.concat([templateBuf, Buffer.from(`id-${i}`)])
    fs.writeFileSync(installed, buf)
    fs.writeFileSync(source, buf)
    entries.push({
      id: `entry-${i}`,
      status: 'installed',
      sourcePath: source,
      sourcePresent: true,
      installedPath: installed,
      format: 'ttf',
      faces: [{ postscriptName: `Bench-${i}`, familyName: 'Bench', subfamilyName: 'Regular' }],
      installations: [
        {
          destinationId: 'macos',
          path: installed,
          verification: 'file-present',
          fingerprint: `fp-${i}`,
        },
      ],
      addedAt: new Date().toISOString(),
    })
  }
  fs.writeFileSync(
    path.join(dataRoot, 'catalog.json'),
    JSON.stringify({ version: 1, entries }, null, 0),
  )
  fs.writeFileSync(
    path.join(dataRoot, 'settings.json'),
    JSON.stringify(
      {
        onboardingCompleted: true,
        folders: [{ id: 'watch-1', root: watchRoot, policy: 'library', watching: true }],
      },
      null,
      0,
    ),
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
        finish(new Error(`worker exited ${code} before init complete\n${buffer.slice(-500)}`))
      }
    })
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      if (listenMs === null && /Font Buttler API on /.test(buffer)) {
        listenMs = Date.now() - t0
      }
      if (initMs === null && /Font Buttler init complete/.test(buffer)) {
        initMs = Date.now() - t0
        finish(null, { listenMs, initMs, n: buffer.match(/127\.0\.0\.1:(\d+)/)?.[1] })
      }
    })
    child.stderr.on('data', (chunk) => {
      buffer += String(chunk)
    })
  })
}

const before = {
  2000: { listenMs: 4118, initMs: null },
  11000: { listenMs: null, initMs: null, fail: '20s timeout' },
  20000: { listenMs: null, initMs: null, fail: '20s timeout (not in audit; extrapolated)' },
}
before[6000] = { listenMs: 11814 }
before[9000] = { listenMs: 18346 }
before[11000] = { listenMs: 20019, fail: '20s timeout' }

console.log('Blank-window startup benchmark (Linux VM, Node spawn harness)')
console.log('| N | listen (before) | listen (after) | init complete (after) |')
console.log('|---:|---:|---:|---:|')

for (const n of counts) {
  process.stderr.write(`Building fixture N=${n}…\n`)
  const dataDir = buildFixture(n)
  try {
    const result = await spawnWorker(dataDir, 43180 + (n % 10))
    const prev = before[n] ?? { listenMs: '—' }
    console.log(
      `| ${n} | ${prev.fail ? prev.fail : prev.listenMs ?? '—'} | ${result.listenMs} | ${result.initMs} |`,
    )
  } catch (error) {
    console.log(`| ${n} | — | FAIL | ${error instanceof Error ? error.message : error} |`)
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

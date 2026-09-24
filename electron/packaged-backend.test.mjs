import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the packaged app runs the API in a child process, not in Electron main', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.match(main, /utilityProcess\.fork/)
  assert.match(main, /FONT_BUTLER_SERVE/)
  assert.match(main, /spawnApiWorker/)
  assert.doesNotMatch(main, /await import\('\.\/server\.bundle\.mjs'\)/)
})

test('spawnApiWorker has no fixed startup timeout', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(main, /Font Buttler API worker did not start'\)[\s\S]{0,120}20_000/)
})

test('corrupt catalog keeps the API worker alive and reports failed health', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'fb-corrupt-'))
  writeFileSync(path.join(dataDir, 'catalog.json'), '{not json')
  writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ onboardingCompleted: true }))
  const port = 43297
  const result = await new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      FONT_BUTLER_SERVE: '1',
      FONT_BUTLER_DATA: dataDir,
      FONT_BUTLER_API_PORT: String(port),
    }
    delete env.FONT_BUTLER_TEST
    delete env.FONT_BUTLER_DEV_BOOTSTRAP
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdout = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.on('exit', (code) => {
      reject(new Error(`worker exited early with ${code}\n${stderr}`))
    })
    const started = Date.now()
    const poll = setInterval(async () => {
      if (!stdout.includes('Font Buttler API on')) return
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`)
        const health = await response.json()
        if (health.phase === 'failed') {
          clearInterval(poll)
          child.kill()
          resolve({ health, stderr, ms: Date.now() - started })
        }
      } catch {
        // keep polling until listen
      }
    }, 40)
    setTimeout(() => {
      clearInterval(poll)
      child.kill()
      reject(new Error(`timed out waiting for failed health\n${stderr}`))
    }, 15_000)
  })
  assert.match(result.stderr, /Font Buttler service init failed/)
  assert.equal(result.health.phase, 'failed')
  assert.ok(result.health.error)
  assert.ok(result.ms < 10_000, `expected fast failure, got ${result.ms}ms`)
})

test('server starts listening before catalog and background init', () => {
  const server = readFileSync(path.join(repoRoot, 'server/index.ts'), 'utf8')
  const serveCallbackIdx = server.indexOf('serve({ fetch: app.fetch')
  const runInitCallIdx = server.indexOf('void runServiceInit()')
  assert.ok(serveCallbackIdx > 0 && runInitCallIdx > serveCallbackIdx)
  assert.match(server, /await service\.initCatalogPhase\(\)/)
  assert.match(server, /await service\.initBackgroundPhase\(\)/)
  assert.match(server, /Font Buttler catalog ready/)
  assert.doesNotMatch(server, /process\.exit\(1\)/)
  assert.match(server, /await backgroundReady/)
  assert.match(server, /service\.startPreviewBackfill\(\)/)
})

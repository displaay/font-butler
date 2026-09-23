import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pythonScriptArgv, pythonSpawnEnv, type PythonRuntime } from './python-runtime.ts'

function readRepo(relativePath: string): string {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function sourceFiles(dir: string): string[] {
  const root = new URL(`../${dir}/`, import.meta.url)
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name))
    .map((entry) =>
      path.relative(
        fs.realpathSync(new URL('../', import.meta.url)),
        path.join(entry.parentPath, entry.name),
      ),
    )
}

test('bundled Python runs isolated and never writes bytecode', () => {
  const bundled: PythonRuntime = { command: '/r/python3', script: '/r/s.py', source: 'bundled' }
  const system: PythonRuntime = { command: 'python3', script: '/r/s.py', source: 'system' }
  assert.deepEqual(pythonScriptArgv(bundled, ['a']), ['-I', '-B', '/r/s.py', '--', 'a'])
  assert.deepEqual(pythonScriptArgv(system, ['a']), ['-B', '/r/s.py', '--', 'a'])
  assert.equal(pythonSpawnEnv({ PATH: '/bin' }).PYTHONDONTWRITEBYTECODE, '1')
  assert.equal(pythonSpawnEnv({ PATH: '/bin' }).PATH, '/bin')
})

test('every spawn of the Python runtime passes -B argv and the no-bytecode env', () => {
  const files = [...sourceFiles('core'), ...sourceFiles('server'), ...sourceFiles('electron')]
  const spawnSites = files.filter((file) => /runtime\.command/.test(readRepo(file)))
  assert.deepEqual(spawnSites.sort(), ['core/materialise.ts', 'core/rename.ts'])
  for (const file of spawnSites) {
    const source = readRepo(file)
    const calls = [...source.matchAll(/execFile\w*\(\s*runtime\.command,([\s\S]*?)\n\s*\)/g)]
    assert.ok(calls.length > 0, `${file} spawns runtime.command without execFile`)
    assert.equal(
      calls.length,
      source.match(/runtime\.command/g)?.length,
      `${file} uses runtime.command outside an execFile call`,
    )
    for (const [call] of calls) {
      assert.match(call, /(rename|materialise)PythonArgv\(/, `${file} builds argv without pythonScriptArgv`)
      assert.match(call, /env: pythonSpawnEnv\(\)/, `${file} spawns Python without pythonSpawnEnv`)
    }
    assert.match(source, /return pythonScriptArgv\(runtime,/)
  }
})

test('a script imported under the runtime argv leaves no __pycache__ behind', (t) => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' })
  } catch {
    t.skip('python3 is not available')
    return
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-pyc-'))
  fs.writeFileSync(path.join(dir, 'helper_mod.py'), 'VALUE = 1\n')
  fs.writeFileSync(path.join(dir, 'main.py'), 'import sys\nsys.path.insert(0, sys.argv[0].rsplit("/", 1)[0])\nimport helper_mod\n')
  const runtime: PythonRuntime = { command: 'python3', script: path.join(dir, 'main.py'), source: 'bundled' }
  execFileSync(runtime.command, pythonScriptArgv(runtime, []), { env: pythonSpawnEnv() })
  assert.equal(fs.existsSync(path.join(dir, '__pycache__')), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

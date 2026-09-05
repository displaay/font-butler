import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { resolveRenameRuntime } from './rename.ts'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-rename-'))
}

test('resolveRenameRuntime prefers a packaged Python over a vendor or system runtime', () => {
  const resources = tempRoot()
  const root = tempRoot()
  const packagedPython = path.join(resources, 'python', 'bin', 'python3')
  const packagedScript = path.join(resources, 'python', 'rename_family.py')
  fs.mkdirSync(path.dirname(packagedPython), { recursive: true })
  fs.writeFileSync(packagedPython, '')
  fs.writeFileSync(packagedScript, '')
  fs.mkdirSync(path.join(root, 'vendor/python/bin'), { recursive: true })
  fs.writeFileSync(path.join(root, 'vendor/python/bin/python3'), '')
  fs.writeFileSync(path.join(root, 'vendor/python/rename_family.py'), '')
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts/rename_family.py'), '')

  const runtime = resolveRenameRuntime({ resourcesPath: resources, root })
  assert.deepEqual(runtime, {
    command: packagedPython,
    script: packagedScript,
    source: 'bundled',
  })
})

test('resolveRenameRuntime uses vendor/python when the app is not packaged', () => {
  const root = tempRoot()
  const vendorPython = path.join(root, 'vendor/python/bin/python3')
  const vendorScript = path.join(root, 'vendor/python/rename_family.py')
  fs.mkdirSync(path.dirname(vendorPython), { recursive: true })
  fs.writeFileSync(vendorPython, '')
  fs.writeFileSync(vendorScript, '')
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts/rename_family.py'), '')

  const runtime = resolveRenameRuntime({ resourcesPath: '', root })
  assert.deepEqual(runtime, {
    command: vendorPython,
    script: vendorScript,
    source: 'bundled',
  })
})

test('resolveRenameRuntime falls back to system python3 and the project script', () => {
  const root = tempRoot()
  const script = path.join(root, 'scripts/rename_family.py')
  fs.mkdirSync(path.dirname(script), { recursive: true })
  fs.writeFileSync(script, '')

  const runtime = resolveRenameRuntime({ resourcesPath: '', root })
  assert.deepEqual(runtime, {
    command: 'python3',
    script,
    source: 'system',
  })
})

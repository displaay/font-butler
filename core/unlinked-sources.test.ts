import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import type { AppPaths } from './paths.ts'
import { tempPaths } from './test-util.ts'
import { allowUnlinkedSource, isUnlinkedSource, rememberUnlinkedSource } from './unlinked-sources.ts'

function withTemp(run: (paths: AppPaths) => void): void {
  const paths = tempPaths('font-butler-unlinked-')
  try {
    run(paths)
  } finally {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true })
  }
}

function withPlatform(platform: NodeJS.Platform, run: () => void): void {
  const previous = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    run()
  } finally {
    Object.defineProperty(process, 'platform', { value: previous })
  }
}

function listFile(paths: AppPaths): string {
  return path.join(paths.dataRoot, 'unlinked-sources.json')
}

test('unlinked path keys treat composed and decomposed names as the same file', () => {
  withTemp((paths) => {
    const composed = path.join(paths.dataRoot, 'Café.otf')
    const decomposed = composed.normalize('NFD')
    assert.notEqual(composed, decomposed)
    rememberUnlinkedSource(paths, decomposed)
    assert.equal(isUnlinkedSource(paths, composed), true)
    assert.equal(isUnlinkedSource(paths, decomposed), true)
    const stored = JSON.parse(fs.readFileSync(listFile(paths), 'utf8')) as { paths: string[] }
    const expected = path.resolve(composed).normalize('NFC')
    assert.equal(stored.paths[0], process.platform === 'darwin' ? expected.toLowerCase() : expected)
    allowUnlinkedSource(paths, composed)
    assert.equal(isUnlinkedSource(paths, decomposed), false)
  })
})

test('unlinked path keys ignore case on darwin and keep it elsewhere', () => {
  const upperName = path.join('Fonts', 'Reckless.otf')
  const lowerName = path.join('fonts', 'reckless.otf')
  withPlatform('darwin', () => {
    withTemp((paths) => {
      const upper = path.join(paths.dataRoot, upperName)
      const lower = path.join(paths.dataRoot, lowerName)
      rememberUnlinkedSource(paths, upper)
      assert.equal(isUnlinkedSource(paths, lower), true)
      const stored = JSON.parse(fs.readFileSync(listFile(paths), 'utf8')) as { paths: string[] }
      assert.equal(stored.paths[0], path.resolve(upper).normalize('NFC').toLowerCase())
      allowUnlinkedSource(paths, lower)
      assert.equal(isUnlinkedSource(paths, upper), false)
    })
  })
  withPlatform('linux', () => {
    withTemp((paths) => {
      const upper = path.join(paths.dataRoot, upperName)
      const lower = path.join(paths.dataRoot, lowerName)
      rememberUnlinkedSource(paths, upper)
      assert.equal(isUnlinkedSource(paths, lower), false)
      assert.equal(isUnlinkedSource(paths, upper), true)
    })
  })
})

test('a corrupt unlinked-sources file is moved to a bak before a new list is written', () => {
  withTemp((paths) => {
    const target = listFile(paths)
    const corrupt = '{"version":1,"paths":["/earlier/Font.otf"]'
    fs.mkdirSync(paths.dataRoot, { recursive: true })
    fs.writeFileSync(target, corrupt)
    const fresh = path.join(paths.dataRoot, 'New.otf')
    rememberUnlinkedSource(paths, fresh)
    assert.equal(fs.readFileSync(`${target}.bak`, 'utf8'), corrupt)
    const stored = JSON.parse(fs.readFileSync(target, 'utf8')) as { version: number; paths: string[] }
    assert.equal(stored.version, 1)
    assert.equal(isUnlinkedSource(paths, fresh), true)
    assert.equal(stored.paths.includes('/earlier/Font.otf'), false)
  })
})

test('a readable unlinked-sources file is replaced without a bak', () => {
  withTemp((paths) => {
    const first = path.join(paths.dataRoot, 'First.otf')
    const second = path.join(paths.dataRoot, 'Second.otf')
    rememberUnlinkedSource(paths, first)
    rememberUnlinkedSource(paths, second)
    assert.equal(fs.existsSync(`${listFile(paths)}.bak`), false)
    assert.equal(isUnlinkedSource(paths, first), true)
    assert.equal(isUnlinkedSource(paths, second), true)
  })
})

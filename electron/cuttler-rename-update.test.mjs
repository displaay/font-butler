import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  APP_PRODUCT_BUNDLE,
  LEGACY_APP_PRODUCT_BUNDLE,
  TEST_FEED_APP_BUNDLE,
  buildMacSwapScript,
  findUpdateAppBundle,
  isFontButlerAppBundle,
  macArm64ArchiveName,
  macArm64ArchiveNames,
  resolveUpdateInstallAppPath,
  statusPiecesFromFeed,
} from './app-update-install.mjs'

test('both Cuttler.app and Font Buttler.app are accepted product bundles', () => {
  assert.equal(isFontButlerAppBundle('/Applications/Cuttler.app'), true)
  assert.equal(isFontButlerAppBundle('/Applications/Font Buttler.app'), true)
  assert.equal(isFontButlerAppBundle('/Applications/Font Buttler Test.app'), true)
  assert.equal(isFontButlerAppBundle('/Applications/Other.app'), false)
  assert.equal(APP_PRODUCT_BUNDLE, 'Cuttler.app')
  assert.equal(LEGACY_APP_PRODUCT_BUNDLE, 'Font Buttler.app')
})

test('findUpdateAppBundle prefers Cuttler.app then the legacy name', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'font-butler-find-bundle-'))
  try {
    const cuttler = path.join(root, 'Cuttler.app')
    const legacy = path.join(root, 'Font Buttler.app')
    mkdirSync(cuttler, { recursive: true })
    mkdirSync(legacy, { recursive: true })
    assert.equal(findUpdateAppBundle(root), cuttler)

    rmSync(cuttler, { recursive: true, force: true })
    assert.equal(findUpdateAppBundle(root), legacy)

    const nestedRoot = path.join(root, 'nested')
    const nested = path.join(nestedRoot, 'payload', 'Cuttler.app')
    mkdirSync(nested, { recursive: true })
    assert.equal(findUpdateAppBundle(nestedRoot), nested)

    rmSync(legacy, { recursive: true, force: true })
    mkdirSync(path.join(root, TEST_FEED_APP_BUNDLE), { recursive: true })
    assert.equal(findUpdateAppBundle(root), path.join(root, TEST_FEED_APP_BUNDLE))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('swap script targets the named Cuttler.app destination, not the running Font Buttler.app path', () => {
  const script = buildMacSwapScript({
    pid: 50,
    currentApp: '/Applications/Font Buttler.app',
    nextApp: '/tmp/next/Font Buttler.app',
    installApp: resolveUpdateInstallAppPath('/Applications/Font Buttler.app'),
    tempDir: '/tmp/font-butler-update',
    scriptPath: '/tmp/font-butler-swap.sh',
  })
  assert.equal(resolveUpdateInstallAppPath('/Applications/Font Buttler.app'), '/Applications/Cuttler.app')
  assert.match(script, /mv '\/tmp\/next\/Font Buttler\.app' '\/Applications\/Cuttler\.app'/)
  assert.match(script, /open '\/Applications\/Cuttler\.app'/)
  assert.match(script, /mv '\/Applications\/Font Buttler\.app' '\/Applications\/Font Buttler\.app\.font-butler-previous'/)
  assert.doesNotMatch(script, /mv '\/tmp\/next\/Font Buttler\.app' '\/Applications\/Font Buttler\.app'/)
})

test('same-path Cuttler updates still swap into the running bundle', () => {
  const install = resolveUpdateInstallAppPath('/Applications/Cuttler.app')
  assert.equal(install, '/Applications/Cuttler.app')
  const script = buildMacSwapScript({
    pid: 50,
    currentApp: '/Applications/Cuttler.app',
    nextApp: '/tmp/next/Cuttler.app',
    installApp: install,
    tempDir: '/tmp/font-butler-update',
    scriptPath: '/tmp/font-butler-swap.sh',
  })
  assert.match(script, /mv '\/tmp\/next\/Cuttler\.app' '\/Applications\/Cuttler\.app'/)
  assert.match(script, /open '\/Applications\/Cuttler\.app'/)
})

test('statusPiecesFromFeed still reads the legacy Font-Buttler zip name and optional Cuttler alias', () => {
  const version = '0.4.0'
  const legacyZip = macArm64ArchiveName(version, 'zip')
  const legacyDmg = macArm64ArchiveName(version, 'dmg')
  assert.equal(legacyZip, 'Font-Buttler-0.4.0-arm64.zip')
  assert.deepEqual(macArm64ArchiveNames(version, 'zip'), [
    'Font-Buttler-0.4.0-arm64.zip',
    'Cuttler-0.4.0-arm64.zip',
  ])
  const yml = `version: ${version}
files:
  - url: ${legacyZip}
    sha512: abc
    size: 12
  - url: ${legacyDmg}
    sha512: def
    size: 34
  - url: Cuttler-0.4.0-arm64.zip
    sha512: ghi
    size: 56
path: ${legacyZip}
`
  const pieces = statusPiecesFromFeed(yml, 'https://example.test/feed/')
  assert.equal(pieces.version, version)
  assert.deepEqual(
    pieces.assets.map((asset) => asset.name),
    [legacyDmg, legacyZip, 'Cuttler-0.4.0-arm64.zip'],
  )
})

test('resolveUpdateInstallAppPath keeps test-feed builds on Font Buttler Test.app', () => {
  assert.equal(
    resolveUpdateInstallAppPath('/Applications/Font Buttler Test/Font Buttler Test.app', {
      testFeedBuild: true,
    }),
    '/Applications/Font Buttler Test/Font Buttler Test.app',
  )
})

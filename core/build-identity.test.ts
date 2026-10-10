import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  allowRealCacheMutation,
  MAC_LOGOUT_APPLESCRIPT,
  MAC_LOGOUT_PROBE_APPLESCRIPT,
  requestMacLogout,
  resetLogoutProbe,
  setMacLogoutExecForTests,
} from './caches.ts'
import {
  buildIdentityCandidates,
  cacheClearLogoutProbe,
  isLogoutProbeEnabled,
  loadBuildIdentity,
  loadBuildIdentityFrom,
  PACKAGED_BUILD_IDENTITY_FAILURE_LOG,
  parseBuildIdentity,
  resetPackagedBuildIdentityLogForTests,
  setBuildIdentityLocationsForTests,
} from './build-identity.ts'
import { projectRoot } from './paths.ts'

test('only boolean testBuild true enables the logout probe', () => {
  assert.equal(parseBuildIdentity('{"testBuild":true}').testBuild, true)
  assert.equal(isLogoutProbeEnabled(parseBuildIdentity('{"testBuild":true}')), true)
  for (const raw of [
    '{"testBuild":false}',
    '{"testBuild":"true"}',
    '{"testBuild":1}',
    '{}',
    'null',
    '',
    'not json',
  ]) {
    const identity = parseBuildIdentity(raw)
    assert.equal(identity.testBuild, false, raw)
    assert.equal(isLogoutProbeEnabled(identity), false, raw)
  }
  assert.equal(cacheClearLogoutProbe({ simulated: true, cleared: false }, { testBuild: true }), true)
  assert.equal(cacheClearLogoutProbe({ simulated: true, cleared: false }, { testBuild: false }), false)
  assert.equal(cacheClearLogoutProbe({ simulated: true, cleared: true }, { testBuild: true }), false)
  assert.equal(cacheClearLogoutProbe({ cleared: true }, { testBuild: true }), true)
  assert.equal(cacheClearLogoutProbe({ cleared: true }, { testBuild: false }), false)
  assert.equal(cacheClearLogoutProbe({ cleared: false }, { testBuild: true }), false)
})

test('the committed build identity stays false and env vars do not enable the probe', () => {
  const file = path.join(projectRoot, 'build', 'build-identity.json')
  const previous = {
    feed: process.env.FONT_BUTLER_TEST_FEED_BUILD,
    test: process.env.FONT_BUTLER_TEST,
    data: process.env.FONT_BUTLER_DATA,
  }
  process.env.FONT_BUTLER_TEST_FEED_BUILD = '1'
  process.env.FONT_BUTLER_TEST = '1'
  process.env.FONT_BUTLER_DATA = '/tmp/font-butler-probe-identity'
  try {
    const raw = fs.readFileSync(file, 'utf8')
    assert.equal(parseBuildIdentity(raw).testBuild, false)
    assert.equal(loadBuildIdentity().testBuild, false)
    const stamped = loadBuildIdentityFrom(
      ['/resources/build-identity.json', file],
      (candidate) => {
        if (candidate.endsWith(`${path.sep}resources${path.sep}build-identity.json`)) {
          return '{"testBuild":true}'
        }
        return raw
      },
    )
    assert.equal(stamped.testBuild, true)
    const release = loadBuildIdentityFrom(
      ['/resources/build-identity.json', file],
      (candidate) => (candidate.startsWith('/resources') ? '{"testBuild":false}' : raw),
    )
    assert.equal(release.testBuild, false)
    const appRoot = path.join(projectRoot, 'Font Buttler Test.app')
    const helper = path.join(
      appRoot,
      'Contents',
      'Frameworks',
      'Font Buttler Test Helper.app',
      'Contents',
      'MacOS',
      'Font Buttler Test Helper',
    )
    const outside = path.join(path.dirname(appRoot), 'Resources', 'build-identity.json')
    const inside = path.join(appRoot, 'Contents', 'Resources', 'build-identity.json')
    const candidates = buildIdentityCandidates(projectRoot, { execPath: helper })
    assert.equal(candidates.includes(inside), true)
    assert.equal(candidates.includes(outside), false)
    const mainExec = path.join(appRoot, 'Contents', 'MacOS', 'Font Buttler Test')
    const mainCandidates = buildIdentityCandidates(projectRoot, { execPath: mainExec })
    assert.equal(mainCandidates.includes(inside), true)
    assert.equal(mainCandidates.includes(outside), false)
    const loose = buildIdentityCandidates(projectRoot, {
      execPath: path.join(path.dirname(appRoot), 'node'),
      resourcesPath: '',
    })
    assert.equal(loose.includes(inside), false)
    assert.equal(loose.includes(outside), false)
    const repoIdentity = path.join(projectRoot, 'build', 'build-identity.json')
    assert.deepEqual(candidates, [inside])
    assert.deepEqual(mainCandidates, [inside])
    assert.equal(loose.includes(repoIdentity), true)
    const electronCandidates = buildIdentityCandidates(projectRoot, {
      execPath: path.join(projectRoot, 'Electron.app', 'Contents', 'MacOS', 'Electron'),
      resourcesPath: '',
    })
    assert.equal(electronCandidates.includes(repoIdentity), true)
    assert.equal(electronCandidates.includes(inside), false)
  } finally {
    if (previous.feed === undefined) delete process.env.FONT_BUTLER_TEST_FEED_BUILD
    else process.env.FONT_BUTLER_TEST_FEED_BUILD = previous.feed
    if (previous.test === undefined) delete process.env.FONT_BUTLER_TEST
    else process.env.FONT_BUTLER_TEST = previous.test
    if (previous.data === undefined) delete process.env.FONT_BUTLER_DATA
    else process.env.FONT_BUTLER_DATA = previous.data
  }
})

test('a packaged release stamp that is exactly false stays a release', () => {
  const layout = packagedLayout()
  fs.writeFileSync(layout.identity, '{"testBuild":false}\n')
  const previous = cacheEnv()
  clearCacheEnv()
  setBuildIdentityLocationsForTests({ execPath: layout.helper, resourcesPath: '' })
  try {
    assert.equal(loadBuildIdentity().testBuild, false)
    assert.equal(allowRealCacheMutation(), true)
    assert.deepEqual(buildIdentityCandidates(projectRoot), [layout.identity])
  } finally {
    restorePackaged(layout, previous)
  }
})

test('a garbage packaged stamp fails closed', async () => {
  await assertPackagedStampFailsClosed({ body: 'not json\n' })
})

test('an unreadable packaged stamp fails closed', async () => {
  await assertPackagedStampFailsClosed({ body: '{"testBuild":false}\n', unreadable: true })
})

test('a missing packaged stamp fails closed', async () => {
  await assertPackagedStampFailsClosed({ missing: true })
})

test('a non-boolean packaged stamp fails closed', async () => {
  await assertPackagedStampFailsClosed({ body: '{"testBuild":"true"}\n' })
})

function packagedLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-packaged-identity-'))
  const app = path.join(root, 'Font Buttler.app')
  const identity = path.join(app, 'Contents', 'Resources', 'build-identity.json')
  const helper = path.join(
    app,
    'Contents',
    'Frameworks',
    'Font Buttler Helper.app',
    'Contents',
    'MacOS',
    'Font Buttler Helper',
  )
  fs.mkdirSync(path.dirname(identity), { recursive: true })
  fs.mkdirSync(path.dirname(helper), { recursive: true })
  return { root, identity, helper }
}

function cacheEnv() {
  return {
    data: process.env.FONT_BUTLER_DATA,
    legacy: process.env.FONTCASE_DATA,
    caches: process.env.FONT_BUTLER_NATIVE_CACHES,
    log: process.env.FONT_BUTLER_LOG,
  }
}

function clearCacheEnv(): void {
  delete process.env.FONT_BUTLER_DATA
  delete process.env.FONTCASE_DATA
  delete process.env.FONT_BUTLER_NATIVE_CACHES
}

function restorePackaged(
  layout: { root: string; identity: string },
  previous: { data?: string; legacy?: string; caches?: string; log?: string },
): void {
  try {
    fs.chmodSync(layout.identity, 0o644)
  } catch {
    // The missing-stamp case has no file to restore.
  }
  setBuildIdentityLocationsForTests(null)
  resetPackagedBuildIdentityLogForTests()
  setMacLogoutExecForTests(null)
  resetLogoutProbe()
  if (previous.data === undefined) delete process.env.FONT_BUTLER_DATA
  else process.env.FONT_BUTLER_DATA = previous.data
  if (previous.legacy === undefined) delete process.env.FONTCASE_DATA
  else process.env.FONTCASE_DATA = previous.legacy
  if (previous.caches === undefined) delete process.env.FONT_BUTLER_NATIVE_CACHES
  else process.env.FONT_BUTLER_NATIVE_CACHES = previous.caches
  if (previous.log === undefined) delete process.env.FONT_BUTLER_LOG
  else process.env.FONT_BUTLER_LOG = previous.log
  fs.rmSync(layout.root, { recursive: true, force: true })
}

async function assertPackagedStampFailsClosed(input: {
  body?: string
  missing?: boolean
  unreadable?: boolean
}): Promise<void> {
  const layout = packagedLayout()
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-butler-identity-log-'))
  const logPath = path.join(logDir, 'main.log')
  const previous = cacheEnv()
  clearCacheEnv()
  process.env.FONT_BUTLER_NATIVE_CACHES = '1'
  process.env.FONT_BUTLER_LOG = logPath
  if (!input.missing && input.body != null) fs.writeFileSync(layout.identity, input.body)
  if (input.unreadable) fs.chmodSync(layout.identity, 0)
  setBuildIdentityLocationsForTests({ execPath: layout.helper, resourcesPath: '' })
  resetPackagedBuildIdentityLogForTests()
  resetLogoutProbe()
  const scripts: string[] = []
  setMacLogoutExecForTests((_file, args, callback) => {
    scripts.push(String(args[1]))
    callback(null)
    return { unref() {} }
  })
  try {
    assert.deepEqual(buildIdentityCandidates(projectRoot), [layout.identity])
    assert.equal(
      buildIdentityCandidates(projectRoot).includes(path.join(projectRoot, 'build', 'build-identity.json')),
      false,
    )
    assert.equal(loadBuildIdentity().testBuild, true)
    assert.equal(loadBuildIdentity().testBuild, true)
    assert.equal(allowRealCacheMutation(), false)
    const result = await requestMacLogout()
    assert.equal(result.probeAllowed, true)
    assert.deepEqual(scripts, [MAC_LOGOUT_PROBE_APPLESCRIPT])
    assert.equal(scripts.includes(MAC_LOGOUT_APPLESCRIPT), false)
    const log = fs.readFileSync(logPath, 'utf8')
    const hits = log.split('\n').filter((line) => line.includes(PACKAGED_BUILD_IDENTITY_FAILURE_LOG))
    assert.equal(hits.length, 1)
  } finally {
    restorePackaged(layout, previous)
    fs.rmSync(logDir, { recursive: true, force: true })
  }
}

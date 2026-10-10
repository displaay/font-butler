import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import {
  buildIdentityCandidates,
  cacheClearLogoutProbe,
  isLogoutProbeEnabled,
  loadBuildIdentity,
  loadBuildIdentityFrom,
  parseBuildIdentity,
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
    })
    assert.equal(loose.includes(inside), false)
    assert.equal(loose.includes(outside), false)
  } finally {
    if (previous.feed === undefined) delete process.env.FONT_BUTLER_TEST_FEED_BUILD
    else process.env.FONT_BUTLER_TEST_FEED_BUILD = previous.feed
    if (previous.test === undefined) delete process.env.FONT_BUTLER_TEST
    else process.env.FONT_BUTLER_TEST = previous.test
    if (previous.data === undefined) delete process.env.FONT_BUTLER_DATA
    else process.env.FONT_BUTLER_DATA = previous.data
  }
})

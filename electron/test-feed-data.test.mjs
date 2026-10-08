import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { applyTestFeedDataIsolation, planTestFeedDataIsolation, TEST_FEED_USER_DATA_DIR } from './test-feed-data.mjs'

function fakeApp(appData) {
  const paths = { appData, userData: path.join(appData, 'Font Buttler') }
  return {
    paths,
    getPath(name) {
      return paths[name]
    },
    setPath(name, value) {
      paths[name] = value
      return undefined
    },
  }
}

function writeBundle(root, pkg) {
  const appPath = path.join(root, 'Font Buttler.app')
  const execPath = path.join(appPath, 'Contents', 'MacOS', 'Font Buttler')
  mkdirSync(path.dirname(execPath), { recursive: true })
  mkdirSync(path.join(appPath, 'Contents', 'Resources', 'app'), { recursive: true })
  writeFileSync(execPath, '')
  writeFileSync(
    path.join(appPath, 'Contents', 'Resources', 'app', 'package.json'),
    JSON.stringify(pkg),
  )
  return execPath
}

test('a marked build isolates userData and sets FONT_BUTLER_DATA when it is unset', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fb-test-feed-'))
  try {
    const execPath = writeBundle(root, { name: 'font-butler', fontButlerTestFeed: true })
    const appData = path.join(root, 'Application Support')
    const app = fakeApp(appData)
    const env = {}
    const plan = applyTestFeedDataIsolation(app, env, execPath)
    const userData = path.join(appData, TEST_FEED_USER_DATA_DIR)
    assert.equal(plan.isolate, true)
    assert.equal(plan.setDataEnv, true)
    assert.equal(app.paths.userData, userData)
    assert.equal(env.FONT_BUTLER_DATA, path.join(userData, 'data'))
    assert.equal(plan.dataDir, env.FONT_BUTLER_DATA)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a marked build keeps an explicit FONT_BUTLER_DATA and still moves userData', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fb-test-feed-'))
  try {
    const execPath = writeBundle(root, { fontButlerTestFeed: true })
    const appData = path.join(root, 'Application Support')
    const app = fakeApp(appData)
    const env = { FONT_BUTLER_DATA: path.join(root, 'custom-data') }
    const plan = applyTestFeedDataIsolation(app, env, execPath)
    assert.equal(plan.isolate, true)
    assert.equal(plan.setDataEnv, false)
    assert.equal(app.paths.userData, path.join(appData, TEST_FEED_USER_DATA_DIR))
    assert.equal(env.FONT_BUTLER_DATA, path.join(root, 'custom-data'))
    assert.equal(plan.dataDir, env.FONT_BUTLER_DATA)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unmarked build does not change userData or FONT_BUTLER_DATA', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fb-test-feed-'))
  try {
    const execPath = writeBundle(root, { name: 'font-butler', version: '0.3.9' })
    const appData = path.join(root, 'Application Support')
    const app = fakeApp(appData)
    const originalUserData = app.paths.userData
    const env = { OTHER: 'kept' }
    const plan = applyTestFeedDataIsolation(app, env, execPath)
    assert.equal(plan.isolate, false)
    assert.equal(plan.userData, null)
    assert.equal(plan.dataDir, null)
    assert.equal(app.paths.userData, originalUserData)
    assert.equal(env.FONT_BUTLER_DATA, undefined)
    assert.equal(env.OTHER, 'kept')
    assert.deepEqual(
      planTestFeedDataIsolation({ testFeedBuild: false, appData, env: { FONT_BUTLER_DATA: '/tmp/real' } }),
      { isolate: false, userData: null, dataDir: null, setDataEnv: false },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('main isolates a test-feed build before the single-instance lock and the worker inherits FONT_BUTLER_DATA', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  const applyAt = main.indexOf('applyTestFeedDataIsolation(app)')
  const lockAt = main.indexOf('requestSingleInstanceLock')
  const readyAt = main.indexOf('app.whenReady')
  assert.ok(applyAt > 0)
  assert.ok(applyAt < lockAt)
  assert.ok(applyAt < readyAt)
  assert.match(main, /FONT_BUTLER_DATA: process\.env\.FONT_BUTLER_DATA/)
})
